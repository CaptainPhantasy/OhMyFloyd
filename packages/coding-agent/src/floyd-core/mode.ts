import * as path from "node:path";
import type { ExperienceEnvelope, FloydClient, FloydProject, FloydRun, FloydStreamEvent } from "@floyd/sdk";
import { Box, Input, ProcessTerminal, replaceTabs, Spacer, Text, TUI, truncateToWidth } from "@oh-my-pi/pi-tui";
import chalk from "chalk";
import {
	FloydCursorPublicationQueue,
	FloydExperienceCoordinator,
	followFloydSession,
	startupShouldContinue,
} from "./experience";

const ACTOR = "ohmyfloyd";
const MAX_EVENT_WIDTH = 240;
const MAX_TRANSCRIPT_ITEMS = 80;
const MAX_ASSISTANT_CHARS = 64 * 1024;

function record(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function textValue(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

function displayError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function sanitizeTerminalText(text: string): string {
	return replaceTabs(
		text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, ""),
	);
}

function safeDisplay(text: string): string {
	return truncateToWidth(sanitizeTerminalText(text), MAX_EVENT_WIDTH);
}

export function formatArtifactContent(value: unknown): string {
	const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
	const sanitized = sanitizeTerminalText(text ?? "");
	return sanitized.length <= 16 * 1024
		? sanitized
		: `${sanitized.slice(0, 16 * 1024)}\n[artifact truncated for TUI display]`;
}

export function formatModelRoute(route: ExperienceEnvelope["model_route"]): string {
	const parts = [route.provider, route.model].filter((value): value is string => Boolean(value));
	return parts.length ? parts.join(" / ") : "Core default";
}

export function pendingInteractionKey(kind: "question" | "permission", value: unknown, index: number): string {
	const payload = record(value);
	const data = record(payload.data);
	const id = textValue(data.id, textValue(data.request_id, textValue(payload.request_id)));
	return `${kind}:${id || index}`;
}

export function classifyDraftRestore(
	localDraft: string,
	lastPublishedDraft: string,
	incomingDraft: string,
): "restore" | "keep-local" | "conflict" {
	if (localDraft === lastPublishedDraft || localDraft === "" || localDraft === incomingDraft) return "restore";
	if (incomingDraft !== lastPublishedDraft) return "conflict";
	return "keep-local";
}

export interface FloydCoreModeOptions {
	client: FloydClient;
	cwd: string;
	projectId?: string;
	continueActive?: boolean;
	handoff?: FloydHandoffSelection;
}

export interface FloydHandoffSelection {
	sessionId: string;
	runId: string;
	lastEventId?: string;
}

export function validateFloydHandoffRun(run: FloydRun, projectId: string, sessionId: string): void {
	if (run.project_id !== projectId) {
		throw new Error(`Run ${run.id} belongs to Core project ${run.project_id}, not cwd project ${projectId}.`);
	}
	if (run.session_id !== sessionId) {
		throw new Error(`Run ${run.id} belongs to Core session ${run.session_id}, not handoff session ${sessionId}.`);
	}
}

/**
 * Presentation-only coding partner. Provider SDKs, credentials, tool
 * execution, durable sessions, and review decisions remain behind Floyd Core.
 */
export class FloydCoreMode {
	readonly #client: FloydClient;
	readonly #cwd: string;
	readonly #requestedProjectId?: string;
	readonly #continueActive: boolean;
	readonly #handoff?: FloydHandoffSelection;
	readonly #ui = new TUI(new ProcessTerminal());
	readonly #transcript = new Box(0, 0);
	readonly #input = new Input();
	readonly #done: Promise<void>;
	#resolveDone: () => void;
	#projectId?: string;
	#runId?: string;
	#sessionId?: string;
	#streamAbort?: AbortController;
	#streamTask?: Promise<void>;
	#interactionAbort?: AbortController;
	#artifactAbort?: AbortController;
	#artifactTask?: Promise<void>;
	#experience?: FloydExperienceCoordinator;
	#experienceApplyChain = Promise.resolve();
	#draftTask?: Promise<void>;
	#lastPublishedDraft = "";
	#blockedConflictingDraft?: string;
	#restoredArtifactId?: string;
	#visiblePendingInteractions = new Set<string>();
	#selectionGeneration = 0;
	readonly #cursorPublications = new FloydCursorPublicationQueue({
		publish: publication => this.#experience?.publishCursor(publication) ?? Promise.resolve(undefined),
		onError: error => this.#addError(displayError(error)),
	});
	#assistantText?: Text;
	#modelRouteText?: Text;
	#inputChain = Promise.resolve();
	#closed = false;

	constructor(options: FloydCoreModeOptions) {
		this.#client = options.client;
		this.#cwd = path.resolve(options.cwd);
		this.#requestedProjectId = options.projectId;
		this.#continueActive = options.continueActive ?? false;
		this.#handoff = options.handoff;
		const deferred = Promise.withResolvers<void>();
		this.#done = deferred.promise;
		this.#resolveDone = deferred.resolve;
	}

	async run(initialMessage?: string): Promise<void> {
		await this.resolveProject();
		const health = await this.#client.health();
		const experience = new FloydExperienceCoordinator({
			client: this.#client,
			onEnvelope: envelope => this.#enqueueEnvelope(envelope),
			onWatchError: error => this.#addError(displayError(error)),
		});
		this.#experience = experience;
		const envelope = await experience.start();
		try {
			const modelRoute = formatModelRoute(envelope.model_route);
			const frame = new Box(1, 1, line => chalk.bgHex("#11131a")(line));
			frame.addChild(
				new Text(
					`${chalk.bold(chalk.hex("#8be9fd")("FLOYD CURSE'M"))}  ${chalk.hex("#bd93f9")("natural-language coding partner")}\n` +
						`Core ${health.ok ? "online" : "offline"}  OpenCode ${health.engine.ok ? "online" : "offline"}  Project ${this.#projectId}  ${this.#cwd}`,
					1,
					0,
				),
			);
			this.#modelRouteText = new Text(`Route ${modelRoute}`, 1, 0);
			frame.addChild(this.#modelRouteText);
			frame.addChild(new Spacer(1));
			frame.addChild(this.#transcript);
			frame.addChild(new Spacer(1));
			frame.addChild(new Text(chalk.dim("Describe a change or type /help. Escape or Ctrl+C exits."), 1, 0));
			frame.addChild(this.#input);
			this.#ui.addChild(frame);
			this.#input.onSubmit = value => {
				this.#input.setValue("");
				this.#enqueueInput(value.trim());
			};
			this.#input.onEscape = () => this.stop();
			this.#ui.addInputListener(data => {
				if (data === "\x03") {
					this.stop();
					return { consume: true };
				}
				return undefined;
			});
			this.#ui.setFocus(this.#input);
			this.#ui.start();
			this.#addSystem("Floyd Core owns this session. Type a coding goal to begin.");
			if (this.#handoff) {
				await this.#selectRun(this.#handoff.runId, {
					expectedProjectId: this.#projectId,
					expectedSessionId: this.#handoff.sessionId,
					lastEventId: this.#handoff.lastEventId,
				});
				await this.#restoreEnvelope(this.#experience.envelope ?? envelope);
			} else {
				await this.#restoreEnvelope(envelope);
			}
			this.#lastPublishedDraft = this.#input.getValue();
			this.#draftTask = this.#publishDraftChanges();
			if (initialMessage) {
				if (!this.#handoff && !startupShouldContinue(initialMessage, this.#continueActive))
					await this.#startNewRunContext(false);
				await this.#handleInput(initialMessage);
			}
			await this.#done;
		} catch (error) {
			await experience.stop();
			throw error;
		}
	}

	stop(): void {
		if (this.#closed) return;
		this.#closed = true;
		const streamGeneration = this.#selectionGeneration;
		this.#selectionGeneration += 1;
		this.#cursorPublications.setGeneration(this.#selectionGeneration);
		// Abort the fetch body immediately, then wait for FloydClient.stream's
		// reader cancellation before restoring the terminal and resolving run().
		this.#streamAbort?.abort();
		this.#interactionAbort?.abort();
		this.#artifactAbort?.abort();
		const streamTask = this.#streamTask;
		const artifactTask = this.#artifactTask;
		const inputTask = this.#inputChain;
		void (async () => {
			await streamTask;
			await artifactTask;
			await inputTask;
			await this.#cursorPublications.stop(streamGeneration);
			await this.#experience?.stop();
			await this.#draftTask;
			this.#streamAbort = undefined;
			this.#streamTask = undefined;
			this.#ui.stop();
			this.#resolveDone();
		})();
	}

	async resolveProject(): Promise<string> {
		const state = await this.#client.state();
		let project: FloydProject | undefined;
		if (this.#requestedProjectId) {
			project = state.projects.find(candidate => candidate.id === this.#requestedProjectId);
			if (!project) throw new Error(`Floyd Core project not found: ${this.#requestedProjectId}`);
		} else {
			project = state.projects.find(candidate => path.resolve(candidate.root_path) === this.#cwd);
		}
		if (project) {
			this.#projectId = project.id;
			return project.id;
		}
		const created = await this.#client.registerProject({ name: path.basename(this.#cwd), root_path: this.#cwd });
		this.#projectId = created.id;
		return created.id;
	}

	#enqueueInput(input: string): void {
		// Serialize rapid submissions instead of clearing and silently dropping
		// input while a previous Core lifecycle request is still resolving.
		this.#inputChain = this.#inputChain.then(() => this.#handleInput(input));
	}

	async #handleInput(input: string): Promise<void> {
		if (!input || this.#closed) return;
		try {
			if (input.startsWith("/")) await this.#handleCommand(input);
			else await this.#send(input);
		} catch (error) {
			this.#addError(displayError(error));
		} finally {
			this.#ui.requestRender();
		}
	}

	async #send(input: string): Promise<void> {
		this.#addUser(input);
		if (this.#sessionId) {
			await this.#client.steer(this.#sessionId, input, ACTOR, undefined, this.#runId);
			return;
		}
		if (!this.#projectId) throw new Error("Floyd Core project is not resolved.");
		const created = await this.#client.submit(this.#projectId, input);
		await this.#selectRun(created.run_id);
	}

	async #handleCommand(input: string): Promise<void> {
		const [command, ...args] = input.split(/\s+/);
		switch (command) {
			case "/help":
				this.#addSystem(
					"/status /new /run ID /answer ID TEXT /allow ID /always ID /deny ID /accept /reject /escalate /quit",
				);
				break;
			case "/status":
				await this.#showStatus();
				break;
			case "/new":
				await this.#startNewRunContext(true);
				this.#addSystem("Ready for a new Floyd Core run.");
				break;
			case "/run":
				if (!args[0]) throw new Error("Usage: /run <id>");
				await this.#selectRun(args[0]);
				break;
			case "/answer":
				if (!this.#sessionId || !args[0] || args.length < 2) throw new Error("Usage: /answer <id> <answer>");
				await this.#runInteraction(
					signal =>
						this.#client.answer(
							this.#sessionId!,
							args[0]!,
							[[args.slice(1).join(" ")]],
							ACTOR,
							signal,
							this.#runId,
						),
					() => this.#addSystem(`Answer sent for ${args[0]}.`),
				);
				break;
			case "/allow":
			case "/always":
			case "/deny": {
				if (!this.#sessionId || !args[0]) throw new Error(`Usage: ${command} <id>`);
				const reply = command === "/allow" ? "once" : command === "/always" ? "always" : "reject";
				await this.#runInteraction(
					signal => this.#client.permission(this.#sessionId!, args[0]!, reply, ACTOR, signal, this.#runId),
					() => this.#addSystem(`Permission response sent for ${args[0]}.`),
				);
				break;
			}
			case "/accept":
			case "/reject":
			case "/escalate":
				if (!this.#runId) throw new Error("No active run.");
				await this.#runInteraction(
					signal =>
						this.#client.decision(
							this.#runId!,
							command.slice(1) as "accept" | "reject" | "escalate",
							ACTOR,
							signal,
						),
					() => this.#addSystem(`Decision recorded: ${command.slice(1)}.`),
				);
				break;
			case "/quit":
				this.stop();
				break;
			default:
				throw new Error(`Unknown Floyd command: ${command}. Use /help.`);
		}
	}

	async #runInteraction(action: (signal: AbortSignal) => Promise<unknown>, onSuccess: () => void): Promise<void> {
		this.#interactionAbort?.abort();
		const controller = new AbortController();
		this.#interactionAbort = controller;
		const generation = this.#selectionGeneration;
		const runId = this.#runId;
		const sessionId = this.#sessionId;
		try {
			await action(controller.signal);
			if (
				!controller.signal.aborted &&
				!this.#closed &&
				generation === this.#selectionGeneration &&
				runId === this.#runId &&
				sessionId === this.#sessionId
			)
				onSuccess();
		} finally {
			if (this.#interactionAbort === controller) this.#interactionAbort = undefined;
		}
	}

	async #showStatus(): Promise<void> {
		const health = await this.#client.health();
		const run = this.#runId ? await this.#client.run(this.#runId) : undefined;
		this.#addSystem(
			`Core ${health.ok ? "online" : "offline"}; OpenCode ${health.engine.ok ? "online" : "offline"}; run ${run?.id ?? "none"}; status ${run?.status ?? "idle"}`,
		);
	}

	async #selectRun(
		runId: string,
		options: {
			publish?: boolean;
			expectedProjectId?: string;
			expectedSessionId?: string | null;
			lastEventId?: string;
		} = {},
	): Promise<void> {
		const previousGeneration = this.#selectionGeneration;
		const generation = ++this.#selectionGeneration;
		this.#interactionAbort?.abort();
		this.#artifactAbort?.abort();
		this.#cursorPublications.setGeneration(generation);
		const run = await this.#client.run(runId);
		if (generation !== this.#selectionGeneration || this.#closed) return;
		if (!run.session_id) throw new Error(`Run ${runId} has no Core session.`);
		if (options.expectedProjectId && options.expectedSessionId) {
			validateFloydHandoffRun(run, options.expectedProjectId, options.expectedSessionId);
		}
		if (options.expectedSessionId && run.session_id !== options.expectedSessionId) {
			throw new Error(`Run ${runId} no longer belongs to Core session ${options.expectedSessionId}.`);
		}
		await this.#detach(previousGeneration);
		if (generation !== this.#selectionGeneration || this.#closed) return;
		this.#runId = run.id;
		this.#sessionId = run.session_id;
		this.#projectId = run.project_id;
		this.#addSystem(`Attached to run ${run.id} (${run.status}).`);
		if (options.publish !== false) {
			const transcriptCursor = options.lastEventId ? Number(options.lastEventId) : 0;
			await this.#experience?.publish({
				active: { project_id: run.project_id, session_id: run.session_id, run_id: run.id },
				transcript_cursor: transcriptCursor,
				last_event_id: options.lastEventId ?? null,
				selected_view: "tui:run",
				composer_draft: this.#input.getValue(),
			});
			if (generation !== this.#selectionGeneration || this.#closed) return;
		}
		const controller = new AbortController();
		this.#streamAbort = controller;
		const task = this.#consumeStream(run.session_id, run.id, generation, controller, options.lastEventId);
		this.#streamTask = task;
		void task.finally(() => {
			if (this.#streamTask === task) this.#streamTask = undefined;
		});
	}

	async #consumeStream(
		sessionId: string,
		runId: string,
		generation: number,
		controller: AbortController,
		lastEventId?: string,
	): Promise<void> {
		try {
			await followFloydSession({
				client: this.#client,
				sessionId,
				runId,
				actor: ACTOR,
				signal: controller.signal,
				initialLastEventId: lastEventId,
				initialEpoch: this.#experience?.envelope?.transcript_epoch,
				onEpochChange: async epoch => {
					if (generation !== this.#selectionGeneration || this.#closed) return;
					this.#assistantText = undefined;
					this.#transcript.clear();
					this.#addSystem("Core stream restarted; restoring the authoritative transcript.");
					await this.#experience?.publish({ transcript_epoch: epoch, transcript_cursor: 0, last_event_id: null });
				},
				onReconnectError: (error, attempt) => {
					if (attempt === 1 || attempt % 5 === 0)
						this.#addError(`Stream reconnect attempt ${attempt}: ${displayError(error)}`);
				},
				onEvent: async event => {
					if (controller.signal.aborted || this.#closed || generation !== this.#selectionGeneration) return;
					this.#renderEvent(event);
					if (event.id) {
						const cursor = Number(event.id);
						const experience = this.#experience;
						if (Number.isFinite(cursor) && experience) {
							this.#cursorPublications.queue(
								{
									runId,
									epoch: experience.envelope?.transcript_epoch ?? null,
									cursor,
									eventId: event.id,
								},
								generation,
							);
						}
					}
				},
			});
		} catch (error) {
			if (!controller.signal.aborted) this.#addError(displayError(error));
		} finally {
			await this.#cursorPublications.flush(generation, true);
			if (this.#streamAbort === controller) this.#streamAbort = undefined;
			this.#ui.requestRender();
		}
	}

	#renderEvent(event: FloydStreamEvent): void {
		const payload = record(event.data);
		if (event.type === "transcript") {
			this.#renderTranscriptSnapshot(payload.messages);
			return;
		}
		const data = record(payload.data);
		if (event.type === "token" && payload.channel === "text") {
			const delta = textValue(data.delta, textValue(data.text));
			if (!delta) return;
			if (!this.#assistantText) {
				this.#assistantText = new Text(`${chalk.hex("#8be9fd")("Floyd")}\n`, 1, 1);
				this.#addTranscript(this.#assistantText);
			}
			const next = `${this.#assistantText.getText()}${sanitizeTerminalText(delta)}`;
			this.#assistantText.setText(
				next.length <= MAX_ASSISTANT_CHARS
					? next
					: `${chalk.hex("#8be9fd")("Floyd")}\n[earlier streamed output truncated]\n${next.slice(-MAX_ASSISTANT_CHARS)}`,
			);
			this.#ui.requestRender();
			return;
		}
		this.#assistantText = undefined;
		if (event.type === "question") {
			this.#addEvent(`Question: ${safeDisplay(JSON.stringify(data))}\nUse /answer <id> <answer>.`);
		} else if (event.type === "permission") {
			this.#addEvent(
				`Permission: ${safeDisplay(JSON.stringify(data))}\nUse /allow, /always, or /deny with the request ID.`,
			);
		} else {
			this.#addEvent(`${event.type}: ${safeDisplay(JSON.stringify(data))}`);
		}
	}

	#renderTranscriptSnapshot(value: unknown): void {
		if (!Array.isArray(value)) return;
		const messages = [...value].sort((left, right) => {
			const leftTime = Number(record(record(left).time).created ?? 0);
			const rightTime = Number(record(record(right).time).created ?? 0);
			return leftTime - rightTime;
		});
		for (const raw of messages) {
			const message = record(raw);
			const role = textValue(message.type, textValue(record(message.info).role, "event"));
			const content = Array.isArray(message.content)
				? message.content
				: Array.isArray(message.parts)
					? message.parts
					: [];
			const text = content
				.map(part => textValue(record(part).text))
				.filter(Boolean)
				.join("\n");
			if (!text) continue;
			if (role === "user") this.#addUser(text);
			else this.#addTranscript(new Text(`${chalk.hex("#8be9fd")("Floyd")}\n${safeDisplay(text)}`, 1, 1));
		}
	}

	async #detach(generation = this.#selectionGeneration): Promise<void> {
		await this.#cursorPublications.flush(generation, true);
		const controller = this.#streamAbort;
		const task = this.#streamTask;
		if (!controller && !task) return;
		controller?.abort();
		await task;
		if (this.#streamAbort === controller) this.#streamAbort = undefined;
		if (this.#streamTask === task) this.#streamTask = undefined;
	}

	#enqueueEnvelope(envelope: ExperienceEnvelope): Promise<void> {
		const apply = this.#experienceApplyChain.then(() => this.#restoreEnvelope(envelope));
		this.#experienceApplyChain = apply.catch(error => this.#addError(displayError(error)));
		return apply;
	}

	async #restoreEnvelope(envelope: ExperienceEnvelope): Promise<void> {
		if (this.#closed) return;
		this.#modelRouteText?.setText(`Route ${formatModelRoute(envelope.model_route)}`);
		this.#ui.requestRender();
		const localDraft = this.#input.getValue();
		const draftDecision = classifyDraftRestore(localDraft, this.#lastPublishedDraft, envelope.composer_draft);
		if (draftDecision === "restore") {
			this.#input.setValue(envelope.composer_draft);
			this.#lastPublishedDraft = envelope.composer_draft;
			this.#blockedConflictingDraft = undefined;
		} else if (draftDecision === "conflict") {
			this.#lastPublishedDraft = envelope.composer_draft;
			if (this.#blockedConflictingDraft !== localDraft) {
				this.#blockedConflictingDraft = localDraft;
				this.#addError(
					"Draft changed in another Floyd surface. Your local text is preserved; edit it again to publish an override.",
				);
			}
		}
		const active = envelope.active;
		if (active.project_id !== this.#projectId || !active.run_id || !active.session_id) {
			if (this.#runId && active.run_id !== this.#runId) {
				const previousGeneration = this.#selectionGeneration;
				this.#selectionGeneration += 1;
				this.#cursorPublications.setGeneration(this.#selectionGeneration);
				await this.#detach(previousGeneration);
				this.#runId = undefined;
				this.#sessionId = undefined;
			}
			return;
		}
		if (active.run_id !== this.#runId || active.session_id !== this.#sessionId) {
			await this.#selectRun(active.run_id, {
				publish: false,
				expectedSessionId: active.session_id,
				lastEventId: envelope.last_event_id ?? undefined,
			});
		}
		const nextPending = new Set<string>();
		for (const [kind, items] of [
			["question", envelope.pending_questions],
			["permission", envelope.pending_permissions],
		] as const) {
			items.forEach((item, index) => {
				const key = pendingInteractionKey(kind, item, index);
				nextPending.add(key);
				if (this.#visiblePendingInteractions.has(key)) return;
				const data = record(record(item).data);
				const id = key.slice(key.indexOf(":") + 1);
				if (kind === "question") {
					this.#addEvent(
						`Pending question ${id}: ${safeDisplay(JSON.stringify(data))}\nUse /answer ${id} <answer>.`,
					);
				} else {
					this.#addEvent(
						`Pending permission ${id}: ${safeDisplay(JSON.stringify(data))}\nUse /allow, /always, or /deny ${id}.`,
					);
				}
			});
		}
		this.#visiblePendingInteractions = nextPending;
		if (
			envelope.selected_artifact_id &&
			envelope.selected_artifact_id !== this.#restoredArtifactId &&
			envelope.selected_view.includes("artifact")
		)
			this.#scheduleArtifactRestore(envelope);
		else this.#artifactAbort?.abort();
	}

	#scheduleArtifactRestore(envelope: ExperienceEnvelope): void {
		this.#artifactAbort?.abort();
		const controller = new AbortController();
		this.#artifactAbort = controller;
		const artifactId = envelope.selected_artifact_id!;
		const runId = envelope.active.run_id;
		const generation = this.#selectionGeneration;
		const task = (async () => {
			try {
				const artifact = await this.#client.artifactById(artifactId, controller.signal);
				const current = this.#experience?.envelope;
				if (
					controller.signal.aborted ||
					this.#closed ||
					generation !== this.#selectionGeneration ||
					runId !== this.#runId ||
					current?.active.run_id !== runId ||
					current.selected_artifact_id !== artifactId
				)
					return;
				this.#restoredArtifactId = artifactId;
				this.#addTranscript(
					new Text(
						`${chalk.hex("#bd93f9")(`Artifact ${artifactId.slice(0, 12)}`)}\n${formatArtifactContent(artifact)}`,
						1,
						1,
					),
				);
				this.#ui.requestRender();
			} catch (error) {
				if (!controller.signal.aborted) this.#addError(`Artifact unavailable: ${displayError(error)}`);
			} finally {
				if (this.#artifactAbort === controller) this.#artifactAbort = undefined;
			}
		})();
		this.#artifactTask = task;
		void task.finally(() => {
			if (this.#artifactTask === task) this.#artifactTask = undefined;
		});
	}

	async #startNewRunContext(publish: boolean): Promise<void> {
		const previousGeneration = this.#selectionGeneration;
		this.#selectionGeneration += 1;
		this.#interactionAbort?.abort();
		this.#artifactAbort?.abort();
		this.#cursorPublications.setGeneration(this.#selectionGeneration);
		await this.#detach(previousGeneration);
		this.#runId = undefined;
		this.#sessionId = undefined;
		if (publish) {
			await this.#experience?.publish({
				active: { project_id: this.#projectId ?? null, session_id: null, run_id: null },
				transcript_cursor: 0,
				last_event_id: null,
				selected_artifact_id: null,
				selected_view: "tui:new-task",
				composer_draft: this.#input.getValue(),
			});
		}
	}

	async #publishDraftChanges(): Promise<void> {
		while (!this.#closed) {
			await Bun.sleep(350);
			if (this.#closed) break;
			const draft = this.#input.getValue();
			if (draft === this.#lastPublishedDraft) continue;
			if (draft === this.#blockedConflictingDraft) continue;
			if (this.#blockedConflictingDraft !== undefined) this.#blockedConflictingDraft = undefined;
			try {
				await this.#experience?.publish({ composer_draft: draft });
				this.#lastPublishedDraft = draft;
			} catch (error) {
				this.#addError(displayError(error));
			}
		}
	}

	#addUser(text: string): void {
		this.#assistantText = undefined;
		this.#addTranscript(new Text(`${chalk.dim("You")}\n${safeDisplay(text)}`, 1, 1));
	}

	#addSystem(text: string): void {
		this.#assistantText = undefined;
		this.#addTranscript(new Text(chalk.dim(`Core\n${safeDisplay(text)}`), 1, 1));
		this.#ui.requestRender();
	}

	#addEvent(text: string): void {
		this.#assistantText = undefined;
		this.#addTranscript(new Text(chalk.hex("#ffb86c")(`Event\n${safeDisplay(text)}`), 1, 1));
		this.#ui.requestRender();
	}

	#addError(text: string): void {
		this.#assistantText = undefined;
		this.#addTranscript(new Text(chalk.hex("#ff5555")(`Core error\n${safeDisplay(text)}`), 1, 1));
		this.#ui.requestRender();
	}

	#addTranscript(component: Text): void {
		this.#transcript.addChild(component);
		while (this.#transcript.children.length > MAX_TRANSCRIPT_ITEMS) this.#transcript.children.shift();
	}
}
