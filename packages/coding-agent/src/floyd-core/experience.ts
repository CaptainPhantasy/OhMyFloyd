import {
	type ExperienceEnvelope,
	type ExperienceEnvelopePatch,
	FLOYD_SDK_PROTOCOL_VERSION,
	type FloydClient,
	type FloydStreamEvent,
} from "@floyd/sdk";

export const FLOYD_TUI_SURFACE_ID = "tui";
export const FLOYD_TUI_CAPABILITIES = [
	"active-context",
	"coding-runs",
	"durable-transcript",
	"transcript-cursor",
	"questions",
	"permissions",
	"artifacts",
	"drafts",
	"selected-view",
	"experience-stream",
	"model-route-display",
] as const;

export type FloydSessionStreamClient = Pick<FloydClient, "attachSession" | "experience">;

export interface FollowFloydSessionOptions {
	client: FloydSessionStreamClient;
	sessionId: string;
	runId: string;
	actor: string;
	signal: AbortSignal;
	initialLastEventId?: string;
	initialEpoch?: string | null;
	onEvent: (event: FloydStreamEvent) => void | Promise<void>;
	onEpochChange: (epoch: string) => void | Promise<void>;
	onReconnectError?: (error: unknown, attempt: number) => void;
	reconnectBaseDelayMs?: number;
	reconnectMaxDelayMs?: number;
}

function nextEventId(current: string | undefined, candidate: string | null | undefined): string | undefined {
	if (!candidate) return current;
	const currentNumber = Number(current);
	const candidateNumber = Number(candidate);
	if (Number.isFinite(currentNumber) && Number.isFinite(candidateNumber)) {
		return candidateNumber > currentNumber ? candidate : current;
	}
	return candidate;
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
	return new Promise(resolve => {
		const finish = () => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		};
		const timer = setTimeout(finish, delayMs);
		const onAbort = () => {
			clearTimeout(timer);
			finish();
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * Follows a semantic Core session until explicitly aborted. Unexpected EOF is
 * a transport failure, not successful completion. Reconnects resume from the
 * last event observed by this process; a Core epoch change deliberately drops
 * that cursor and reconnects once without it so Core sends a fresh transcript.
 */
export async function followFloydSession(options: FollowFloydSessionOptions): Promise<void> {
	let lastEventId = options.initialLastEventId;
	let epoch = options.initialEpoch ?? null;
	let failures = 0;
	while (!options.signal.aborted) {
		let epochChanged = false;
		try {
			for await (const event of options.client.attachSession(options.sessionId, options.actor, {
				signal: options.signal,
				runId: options.runId,
				lastEventId,
			})) {
				if (options.signal.aborted) return;
				if (event.type === "hello") {
					const data = typeof event.data === "object" && event.data ? (event.data as Record<string, unknown>) : {};
					const nextEpoch = typeof data.stream_epoch === "string" ? data.stream_epoch : "";
					if (nextEpoch && epoch && nextEpoch !== epoch) {
						epoch = nextEpoch;
						lastEventId = undefined;
						epochChanged = true;
						await options.onEpochChange(nextEpoch);
						break;
					}
					if (nextEpoch) epoch = nextEpoch;
					continue;
				}
				await options.onEvent(event);
				lastEventId = nextEventId(lastEventId, event.id);
				failures = 0;
			}
			if (options.signal.aborted) return;
			if (epochChanged) continue;
			throw new Error("Floyd session stream ended before abort");
		} catch (error) {
			if (options.signal.aborted) return;
			failures += 1;
			options.onReconnectError?.(error, failures);
			try {
				const envelope = await options.client.experience("primary", options.signal);
				if (envelope.active.session_id !== options.sessionId || envelope.active.run_id !== options.runId) return;
				if (epoch && envelope.transcript_epoch && envelope.transcript_epoch !== epoch) {
					epoch = envelope.transcript_epoch;
					lastEventId = undefined;
					await options.onEpochChange(epoch);
				} else {
					lastEventId = nextEventId(lastEventId, envelope.last_event_id);
				}
			} catch (restoreError) {
				if (options.signal.aborted) return;
				options.onReconnectError?.(restoreError, failures);
			}
			const delay = Math.min(
				(options.reconnectBaseDelayMs ?? 150) * 2 ** Math.min(failures - 1, 6),
				options.reconnectMaxDelayMs ?? 2_000,
			);
			await abortableDelay(delay, options.signal);
		}
	}
}

export type FloydExperienceClient = Pick<
	FloydClient,
	"negotiateExperience" | "experience" | "updateExperience" | "watchExperience"
>;

export interface FloydExperienceCoordinatorOptions {
	client: FloydExperienceClient;
	envelopeId?: string;
	onEnvelope: (envelope: ExperienceEnvelope) => void | Promise<void>;
	onWatchError?: (error: unknown) => void;
	reconnectBaseDelayMs?: number;
	reconnectMaxDelayMs?: number;
}

export interface FloydCursorPublication {
	runId: string;
	epoch: string | null;
	cursor: number;
	eventId: string;
}

export interface QueuedFloydCursorPublication extends FloydCursorPublication {
	generation: number;
}

export interface FloydCursorPublicationQueueOptions {
	publish: (publication: FloydCursorPublication) => Promise<unknown>;
	onError?: (error: unknown) => void;
	delayMs?: number;
}

/** Coalesces token-dense cursor updates without crossing run generations. */
export class FloydCursorPublicationQueue {
	readonly #publish: FloydCursorPublicationQueueOptions["publish"];
	readonly #onError: NonNullable<FloydCursorPublicationQueueOptions["onError"]>;
	readonly #delayMs: number;
	#activeGeneration = 0;
	#pending?: QueuedFloydCursorPublication;
	#timerTask?: Promise<void>;
	#stopped = false;

	constructor(options: FloydCursorPublicationQueueOptions) {
		this.#publish = options.publish;
		this.#onError = options.onError ?? (() => {});
		this.#delayMs = options.delayMs ?? 300;
	}

	setGeneration(generation: number): void {
		this.#activeGeneration = generation;
	}

	queue(publication: FloydCursorPublication, generation: number): void {
		if (this.#stopped || generation !== this.#activeGeneration) return;
		const pending = this.#pending;
		if (
			pending &&
			pending.generation === generation &&
			pending.runId === publication.runId &&
			pending.epoch === publication.epoch &&
			pending.cursor >= publication.cursor
		) {
			return;
		}
		this.#pending = { ...publication, generation };
		this.#schedule();
	}

	async flush(generation = this.#activeGeneration, force = false): Promise<void> {
		const pending = this.#pending;
		if (!pending || pending.generation !== generation) return;
		if (!force && (this.#stopped || generation !== this.#activeGeneration)) return;
		this.#pending = undefined;
		try {
			await this.#publish(pending);
		} catch (error) {
			this.#onError(error);
		}
	}

	async stop(generation = this.#activeGeneration): Promise<void> {
		if (this.#stopped) return;
		await this.flush(generation, true);
		this.#stopped = true;
		await this.#timerTask;
	}

	#schedule(): void {
		if (this.#timerTask) return;
		const task = (async () => {
			await Bun.sleep(this.#delayMs);
			await this.flush();
		})();
		this.#timerTask = task;
		void task.finally(() => {
			if (this.#timerTask === task) this.#timerTask = undefined;
			if (this.#pending?.generation === this.#activeGeneration && !this.#stopped) this.#schedule();
		});
	}
}

/** Explicit input is a new task unless the operator opts into continuation. */
export function startupShouldContinue(initialMessage: string | undefined, continueActive: boolean): boolean {
	return !initialMessage || continueActive;
}

/**
 * Owns the portable envelope transport for the TUI. Publications are serialized
 * and optimistic. A 409 is surfaced unchanged; this class never retries a stale
 * mutation over another surface's authoritative state.
 */
export class FloydExperienceCoordinator {
	readonly #client: FloydExperienceClient;
	readonly #envelopeId: string;
	readonly #onEnvelope: FloydExperienceCoordinatorOptions["onEnvelope"];
	readonly #onWatchError: NonNullable<FloydExperienceCoordinatorOptions["onWatchError"]>;
	readonly #reconnectBaseDelayMs: number;
	readonly #reconnectMaxDelayMs: number;
	#envelope?: ExperienceEnvelope;
	#publishTail = Promise.resolve<unknown>(undefined);
	#watchAbort?: AbortController;
	#watchTask?: Promise<void>;
	#closed = false;

	constructor(options: FloydExperienceCoordinatorOptions) {
		this.#client = options.client;
		this.#envelopeId = options.envelopeId ?? "primary";
		this.#onEnvelope = options.onEnvelope;
		this.#onWatchError = options.onWatchError ?? (() => {});
		this.#reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 150;
		this.#reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 2_000;
	}

	get envelope(): ExperienceEnvelope | undefined {
		return this.#envelope;
	}

	async start(): Promise<ExperienceEnvelope> {
		const negotiation = await this.#client.negotiateExperience({
			surface_id: FLOYD_TUI_SURFACE_ID,
			sdk_version: FLOYD_SDK_PROTOCOL_VERSION,
			capabilities: [...FLOYD_TUI_CAPABILITIES],
		});
		if (!negotiation.accepted) {
			throw new Error(negotiation.reason ?? `Floyd experience protocol rejected SDK ${FLOYD_SDK_PROTOCOL_VERSION}`);
		}
		this.#envelope = await this.#client.experience(this.#envelopeId);
		this.#startWatch();
		return this.#envelope;
	}

	publish(change: Omit<ExperienceEnvelopePatch, "expected_revision" | "surface">): Promise<ExperienceEnvelope> {
		const operation = async (): Promise<ExperienceEnvelope> => {
			if (this.#closed) throw new Error("Floyd experience coordinator is closed");
			const base = this.#envelope ?? (await this.#client.experience(this.#envelopeId));
			try {
				const envelope = await this.#client.updateExperience(this.#envelopeId, {
					expected_revision: base.revision,
					...change,
					surface: {
						surface_id: FLOYD_TUI_SURFACE_ID,
						sdk_version: FLOYD_SDK_PROTOCOL_VERSION,
						capabilities: [...FLOYD_TUI_CAPABILITIES],
						transcript_cursor: change.transcript_cursor ?? base.transcript_cursor,
						transcript_epoch: change.transcript_epoch ?? base.transcript_epoch,
						last_event_id: change.last_event_id ?? base.last_event_id,
					},
				});
				if (!this.#envelope || envelope.revision >= this.#envelope.revision) this.#envelope = envelope;
				return this.#envelope;
			} catch (error) {
				// Refresh local truth for recovery, but preserve the original conflict.
				this.#envelope = await this.#client.experience(this.#envelopeId).catch(() => base);
				await this.#onEnvelope(this.#envelope);
				throw error;
			}
		};
		const queued = this.#publishTail.then(operation, operation);
		this.#publishTail = queued.catch(() => undefined);
		return queued;
	}

	async publishCursor(publication: FloydCursorPublication): Promise<ExperienceEnvelope | undefined> {
		const envelope = this.#envelope;
		if (
			!envelope ||
			envelope.active.run_id !== publication.runId ||
			envelope.transcript_epoch !== publication.epoch
		) {
			return undefined;
		}
		if (publication.cursor <= envelope.transcript_cursor) return envelope;
		return this.publish({ transcript_cursor: publication.cursor, last_event_id: publication.eventId });
	}

	async stop(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		this.#watchAbort?.abort();
		await this.#watchTask;
		await this.#publishTail;
	}

	#startWatch(): void {
		const controller = new AbortController();
		this.#watchAbort = controller;
		const task = this.#watch(controller).catch(error => {
			if (!controller.signal.aborted) this.#onWatchError(error);
		});
		this.#watchTask = task;
		void task.finally(() => {
			if (this.#watchTask === task) this.#watchTask = undefined;
		});
	}

	async #watch(controller: AbortController): Promise<void> {
		let failures = 0;
		while (!controller.signal.aborted && !this.#closed) {
			try {
				if (failures > 0) {
					// A fresh GET is authoritative even when Core was restored to a
					// lower revision than this process previously observed.
					const restored = await this.#client.experience(this.#envelopeId, controller.signal);
					if (!this.#envelope || restored.revision !== this.#envelope.revision) {
						this.#envelope = restored;
						await this.#onEnvelope(restored);
					}
				}
				for await (const event of this.#client.watchExperience(this.#envelopeId, {
					lastEventId: String(this.#envelope?.revision ?? 0),
					signal: controller.signal,
				})) {
					if (controller.signal.aborted || this.#closed || event.type !== "experience") continue;
					const envelope = event.data as ExperienceEnvelope;
					if (!envelope || typeof envelope.revision !== "number") continue;
					if (this.#envelope && envelope.revision <= this.#envelope.revision) continue;
					failures = 0;
					this.#envelope = envelope;
					await this.#onEnvelope(envelope);
				}
				if (!controller.signal.aborted && !this.#closed) throw new Error("Floyd experience stream ended");
			} catch (error) {
				if (controller.signal.aborted || this.#closed) return;
				this.#onWatchError(error);
				failures += 1;
				const delay = Math.min(
					this.#reconnectBaseDelayMs * 2 ** Math.min(failures - 1, 6),
					this.#reconnectMaxDelayMs,
				);
				await new Promise<void>(resolve => {
					const timer = setTimeout(resolve, delay);
					controller.signal.addEventListener(
						"abort",
						() => {
							clearTimeout(timer);
							resolve();
						},
						{ once: true },
					);
				});
			}
		}
	}
}
