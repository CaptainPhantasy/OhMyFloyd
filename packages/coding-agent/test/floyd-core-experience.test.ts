import { describe, expect, test } from "bun:test";
import {
	type ExperienceEnvelope,
	type ExperienceEnvelopePatch,
	type ExperienceNegotiationResult,
	FloydApiError,
	type FloydStreamEvent,
} from "@floyd/sdk";
import {
	FLOYD_TUI_CAPABILITIES,
	FLOYD_TUI_SURFACE_ID,
	FloydCursorPublicationQueue,
	type FloydExperienceClient,
	FloydExperienceCoordinator,
	type FloydSessionStreamClient,
	followFloydSession,
	startupShouldContinue,
} from "../src/floyd-core/experience";
import {
	classifyDraftRestore,
	formatArtifactContent,
	formatModelRoute,
	pendingInteractionKey,
} from "../src/floyd-core/mode";

function envelope(revision: number, overrides: Partial<ExperienceEnvelope> = {}): ExperienceEnvelope {
	return {
		id: "primary",
		schema_version: "1.0.0",
		revision,
		active: { project_id: "project-1", session_id: "session-1", run_id: "run-1" },
		model_route: {
			provider: null,
			model: null,
			base_url: null,
			provider_profile_id: null,
			credential_ref: null,
		},
		transcript_cursor: 0,
		transcript_epoch: "epoch-1",
		last_event_id: null,
		pending_questions: [],
		pending_permissions: [],
		composer_draft: "",
		selected_artifact_id: null,
		selected_view: "run",
		surfaces: {},
		updated_at: "2026-07-14T00:00:00.000Z",
		updated_by_device_id: null,
		...overrides,
	};
}

const accepted: ExperienceNegotiationResult = {
	accepted: true,
	envelope_version: "1.0.0",
	core_protocol_version: "1.0.0",
	minimum_sdk_version: "1.0.0",
};

function quietWatch(signal?: AbortSignal): AsyncGenerator<FloydStreamEvent<ExperienceEnvelope>> {
	return (async function* () {
		yield* [] as FloydStreamEvent<ExperienceEnvelope>[];
		while (!signal?.aborted) await Bun.sleep(1);
	})();
}

describe("Floyd Experience coordinator", () => {
	test("starts a new task for explicit input unless continuation is deliberate", () => {
		expect(startupShouldContinue(undefined, false)).toBeTrue();
		expect(startupShouldContinue("fix the parser", false)).toBeFalse();
		expect(startupShouldContinue("fix the parser", true)).toBeTrue();
	});

	test("detects remote draft divergence without overwriting local input", () => {
		expect(classifyDraftRestore("", "base", "remote")).toBe("restore");
		expect(classifyDraftRestore("base", "base", "remote")).toBe("restore");
		expect(classifyDraftRestore("local", "base", "base")).toBe("keep-local");
		expect(classifyDraftRestore("local", "base", "local")).toBe("restore");
		expect(classifyDraftRestore("local", "base", "remote")).toBe("conflict");
	});

	test("renders selected artifact content without terminal control bytes", () => {
		expect(formatArtifactContent("result\u001b[31m\u0000")).toBe("result[31m");
		expect(formatArtifactContent({ status: "pass" })).toContain('"status": "pass"');
		expect(formatArtifactContent("x".repeat(20_000))).toEndWith("[artifact truncated for TUI display]");
	});

	test("displays the active model route without credential material", () => {
		expect(formatModelRoute(envelope(1).model_route)).toBe("Core default");
		expect(
			formatModelRoute({
				provider: "opencode-go",
				model: "qwen-coder",
				base_url: "https://example.test/v1",
				provider_profile_id: "profile-1",
				credential_ref: "floyd-connector:secret",
			}),
		).toBe("opencode-go / qwen-coder");
	});

	test("uses stable request identities for restored pending interactions", () => {
		expect(pendingInteractionKey("question", { data: { id: "q-1" } }, 0)).toBe("question:q-1");
		expect(pendingInteractionKey("permission", { request_id: "p-1" }, 0)).toBe("permission:p-1");
		expect(pendingInteractionKey("question", { data: {} }, 3)).toBe("question:3");
	});

	test("negotiates capabilities and serializes optimistic publications", async () => {
		const firstUpdate = Promise.withResolvers<void>();
		const enteredFirstUpdate = Promise.withResolvers<void>();
		const patches: ExperienceEnvelopePatch[] = [];
		let current = envelope(1);
		const client: FloydExperienceClient = {
			negotiateExperience: async input => {
				expect(input.surface_id).toBe(FLOYD_TUI_SURFACE_ID);
				expect(input.capabilities).toEqual([...FLOYD_TUI_CAPABILITIES]);
				return accepted;
			},
			experience: async () => current,
			updateExperience: async (_id, patch) => {
				patches.push(patch);
				if (patches.length === 1) {
					enteredFirstUpdate.resolve();
					await firstUpdate.promise;
				}
				current = envelope(current.revision + 1, {
					composer_draft: patch.composer_draft ?? current.composer_draft,
					selected_view: patch.selected_view ?? current.selected_view,
				});
				return current;
			},
			watchExperience: (_id, options) => quietWatch(options?.signal),
		};
		const coordinator = new FloydExperienceCoordinator({ client, onEnvelope: () => {} });
		await coordinator.start();
		const first = coordinator.publish({ composer_draft: "draft" });
		await enteredFirstUpdate.promise;
		const second = coordinator.publish({ selected_view: "artifacts" });
		expect(patches).toHaveLength(1);
		firstUpdate.resolve();
		await Promise.all([first, second]);
		expect(patches.map(patch => patch.expected_revision)).toEqual([1, 2]);
		expect(patches[0]?.surface).toMatchObject({
			surface_id: FLOYD_TUI_SURFACE_ID,
			capabilities: [...FLOYD_TUI_CAPABILITIES],
		});
		await coordinator.stop();
	});

	test("refreshes after a conflict without retrying or obscuring the 409", async () => {
		const initial = envelope(4);
		const latest = envelope(5, { composer_draft: "other surface won" });
		const conflict = new FloydApiError("PATCH", "/api/experience/primary", 409, {
			error: "revision_conflict",
			envelope: latest,
		});
		let reads = 0;
		let writes = 0;
		const applied: ExperienceEnvelope[] = [];
		const client: FloydExperienceClient = {
			negotiateExperience: async () => accepted,
			experience: async () => (++reads === 1 ? initial : latest),
			updateExperience: async () => {
				writes += 1;
				throw conflict;
			},
			watchExperience: (_id, options) => quietWatch(options?.signal),
		};
		const coordinator = new FloydExperienceCoordinator({
			client,
			onEnvelope: value => {
				applied.push(value);
			},
		});
		await coordinator.start();
		await expect(coordinator.publish({ composer_draft: "stale edit" })).rejects.toBe(conflict);
		expect(writes).toBe(1);
		expect(coordinator.envelope).toBe(latest);
		expect(applied).toEqual([latest]);
		await coordinator.stop();
	});

	test("reconnects a failed watch and restores authoritative Core state", async () => {
		const initial = envelope(9, { composer_draft: "before restart" });
		const restored = envelope(3, { composer_draft: "after restore" });
		let reads = 0;
		let watches = 0;
		const errors: unknown[] = [];
		const applied: ExperienceEnvelope[] = [];
		const client: FloydExperienceClient = {
			negotiateExperience: async () => accepted,
			experience: async () => (++reads === 1 ? initial : restored),
			updateExperience: async () => restored,
			watchExperience: (_id, options) => {
				watches += 1;
				if (watches === 1)
					return (async function* () {
						yield* [] as FloydStreamEvent<ExperienceEnvelope>[];
						throw new Error("Core restarted");
					})();
				return quietWatch(options?.signal);
			},
		};
		const coordinator = new FloydExperienceCoordinator({
			client,
			onEnvelope: value => {
				applied.push(value);
			},
			onWatchError: error => {
				errors.push(error);
			},
			reconnectBaseDelayMs: 1,
			reconnectMaxDelayMs: 2,
		});
		await coordinator.start();
		for (let attempt = 0; attempt < 100 && watches < 2; attempt += 1) await Bun.sleep(1);
		expect(watches).toBe(2);
		expect(errors).toHaveLength(1);
		expect(coordinator.envelope).toBe(restored);
		expect(applied).toEqual([restored]);
		await coordinator.stop();
	});

	test("resumes an unexpectedly ended semantic session from the last observed event", async () => {
		const controller = new AbortController();
		const requestedCursors: Array<string | undefined> = [];
		const received: string[] = [];
		let streams = 0;
		const client: FloydSessionStreamClient = {
			experience: async () => envelope(2, { last_event_id: "4" }),
			attachSession: (_sessionId, _actor, options) => {
				const streamOptions = options ?? {};
				requestedCursors.push(streamOptions.lastEventId);
				streams += 1;
				if (streams === 1)
					return (async function* () {
						yield { type: "hello", data: { stream_epoch: "epoch-1" } };
						yield { id: "4", type: "token", data: { data: { text: "first" } } };
						throw new Error("socket dropped");
					})();
				return (async function* () {
					yield { type: "hello", data: { stream_epoch: "epoch-1" } };
					yield { id: "5", type: "token", data: { data: { text: "second" } } };
					while (!streamOptions.signal?.aborted) await Bun.sleep(1);
				})();
			},
		};
		await followFloydSession({
			client,
			sessionId: "session-1",
			runId: "run-1",
			actor: "test",
			signal: controller.signal,
			initialEpoch: "epoch-1",
			reconnectBaseDelayMs: 1,
			reconnectMaxDelayMs: 1,
			onEpochChange: () => {},
			onEvent: event => {
				received.push(event.id!);
				if (event.id === "5") controller.abort();
			},
		});
		expect(requestedCursors).toEqual([undefined, "4"]);
		expect(received).toEqual(["4", "5"]);
	});

	test("drops a stale cursor and requests a fresh transcript after an epoch change", async () => {
		const controller = new AbortController();
		const requestedCursors: Array<string | undefined> = [];
		const epochs: string[] = [];
		const received: string[] = [];
		let streams = 0;
		const client: FloydSessionStreamClient = {
			experience: async () => envelope(1),
			attachSession: (_sessionId, _actor, options) => {
				const streamOptions = options ?? {};
				requestedCursors.push(streamOptions.lastEventId);
				streams += 1;
				if (streams === 1)
					return (async function* () {
						yield { type: "hello", data: { stream_epoch: "epoch-2" } };
					})();
				return (async function* () {
					yield { type: "hello", data: { stream_epoch: "epoch-2" } };
					yield { type: "transcript", data: { messages: [] } };
					while (!streamOptions.signal?.aborted) await Bun.sleep(1);
				})();
			},
		};
		await followFloydSession({
			client,
			sessionId: "session-1",
			runId: "run-1",
			actor: "test",
			signal: controller.signal,
			initialLastEventId: "99",
			initialEpoch: "epoch-1",
			onEpochChange: epoch => {
				epochs.push(epoch);
			},
			onEvent: event => {
				received.push(event.type);
				controller.abort();
			},
		});
		expect(requestedCursors).toEqual(["99", undefined]);
		expect(epochs).toEqual(["epoch-2"]);
		expect(received).toEqual(["transcript"]);
	});

	test("publishes cursors only for the matching run and stream epoch", async () => {
		let current = envelope(8, { transcript_cursor: 10 });
		const patches: ExperienceEnvelopePatch[] = [];
		const client: FloydExperienceClient = {
			negotiateExperience: async () => accepted,
			experience: async () => current,
			updateExperience: async (_id, patch) => {
				patches.push(patch);
				current = envelope(9, {
					transcript_cursor: patch.transcript_cursor ?? current.transcript_cursor,
					last_event_id: patch.last_event_id ?? current.last_event_id,
				});
				return current;
			},
			watchExperience: (_id, options) => quietWatch(options?.signal),
		};
		const coordinator = new FloydExperienceCoordinator({ client, onEnvelope: () => {} });
		await coordinator.start();
		await coordinator.publishCursor({ runId: "other", epoch: "epoch-1", cursor: 11, eventId: "11" });
		await coordinator.publishCursor({ runId: "run-1", epoch: "other", cursor: 11, eventId: "11" });
		await coordinator.publishCursor({ runId: "run-1", epoch: "epoch-1", cursor: 10, eventId: "10" });
		await coordinator.publishCursor({ runId: "run-1", epoch: "epoch-1", cursor: 11, eventId: "11" });
		expect(patches).toHaveLength(1);
		expect(patches[0]).toMatchObject({ transcript_cursor: 11, last_event_id: "11" });
		await coordinator.stop();
	});

	test("coalesces dense cursors and rejects stale run generations", async () => {
		const published: Array<{ runId: string; cursor: number }> = [];
		const queue = new FloydCursorPublicationQueue({
			delayMs: 10,
			publish: async publication => {
				published.push({ runId: publication.runId, cursor: publication.cursor });
			},
		});
		queue.setGeneration(4);
		queue.queue({ runId: "run-1", epoch: "epoch-1", cursor: 11, eventId: "11" }, 4);
		queue.queue({ runId: "run-1", epoch: "epoch-1", cursor: 12, eventId: "12" }, 4);
		queue.queue({ runId: "run-1", epoch: "epoch-1", cursor: 13, eventId: "13" }, 4);
		await Bun.sleep(20);
		expect(published).toEqual([{ runId: "run-1", cursor: 13 }]);

		queue.setGeneration(5);
		queue.queue({ runId: "run-1", epoch: "epoch-1", cursor: 14, eventId: "14" }, 4);
		queue.queue({ runId: "run-2", epoch: "epoch-2", cursor: 1, eventId: "1" }, 5);
		await queue.stop(5);
		expect(published).toEqual([
			{ runId: "run-1", cursor: 13 },
			{ runId: "run-2", cursor: 1 },
		]);
	});
});
