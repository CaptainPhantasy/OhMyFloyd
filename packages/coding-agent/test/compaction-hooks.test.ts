/**
 * Integration tests for compaction extension events.
 * Verifies ExtensionRunner correctly emits session_before_compact and session_compact
 * through the real AgentSession path with a real LLM.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { getBundledModel } from "@oh-my-pi/pi-ai";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { loadExtensions } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/loader";
import { ExtensionRunner } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/runner";
import type {
	Extension,
	ExtensionCommandContextActions,
	ExtensionContextActions,
	SessionBeforeCompactEvent,
	SessionCompactEvent,
	SessionEvent,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import { createNoOpUIContext } from "@oh-my-pi/pi-coding-agent/extensibility/utils";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { createTools, type ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { Snowflake } from "@oh-my-pi/pi-utils";
import { e2eApiKey } from "./utilities";

describe.skipIf(!e2eApiKey("ANTHROPIC_API_KEY"))("Compaction extension events", () => {
	let session: AgentSession;
	let tempDir: string;
	let extensionRunner: ExtensionRunner;
	let capturedEvents: SessionEvent[];

	beforeEach(() => {
		tempDir = path.join(os.tmpdir(), `omp-compaction-ext-test-${Snowflake.next()}`);
		fs.mkdirSync(tempDir, { recursive: true });
		capturedEvents = [];
	});

	afterEach(async () => {
		if (session) {
			await session.dispose();
		}
		if (tempDir && fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true });
		}
	});

	/**
	 * Create an Extension object that captures events for testing.
	 */
	function createExtension(
		onBeforeCompact?: (event: SessionBeforeCompactEvent) => { cancel?: boolean; compaction?: unknown } | undefined,
		onCompact?: (event: SessionCompactEvent) => void,
	): Extension {
		const handlers = new Map<string, ((...args: unknown[]) => Promise<unknown>)[]>();

		handlers.set("session_before_compact", [
			async (event: unknown) => {
				capturedEvents.push(event as SessionEvent);
				if (onBeforeCompact) {
					return onBeforeCompact(event as SessionBeforeCompactEvent);
				}
				return undefined;
			},
		]);

		handlers.set("session_compact", [
			async (event: unknown) => {
				capturedEvents.push(event as SessionEvent);
				if (onCompact) {
					onCompact(event as SessionCompactEvent);
				}
				return undefined;
			},
		]);

		return {
			path: "test-extension",
			resolvedPath: "/test/test-extension.ts",
			handlers,
			tools: new Map(),
			messageRenderers: new Map(),
			commands: new Map(),
			flags: new Map(),
			shortcuts: new Map(),
		};
	}

	async function createSession(extensions: Extension[]) {
		const toolSession: ToolSession = {
			cwd: tempDir,
			hasUI: false,
			getSessionFile: () => null,
			getSessionSpawns: () => "*",
			settings: Settings.isolated(),
		};
		const tools = await createTools(toolSession);
		const model = getBundledModel("anthropic", "claude-sonnet-4-5")!;

		const agent = new Agent({
			getApiKey: () => e2eApiKey("ANTHROPIC_API_KEY"),
			initialState: {
				model,
				systemPrompt: "You are a helpful assistant. Be concise.",
				tools,
			},
		});

		const sessionManager = SessionManager.create(tempDir, tempDir);
		const settings = Settings.isolated();
		const authStorage = await AuthStorage.create(path.join(tempDir, "testauth.db"));
		const modelRegistry = new ModelRegistry(authStorage);

		// Build ExtensionRunner from loadExtensions runtime (provides ExtensionRuntime = ExtensionActions + ExtensionRuntimeState)
		const loadResult = await loadExtensions([], tempDir);
		extensionRunner = new ExtensionRunner(extensions, loadResult.runtime, tempDir, sessionManager, modelRegistry);

		const contextActions: ExtensionContextActions = {
			getModel: () => model,
			isIdle: () => !session.isStreaming,
			abort: () => session.abort(),
			hasPendingMessages: () => session.queuedMessageCount > 0,
			shutdown: () => {},
			getContextUsage: () => undefined,
			compact: async () => {},
			getSystemPrompt: () => agent.state.systemPrompt,
		};

		const commandActions: ExtensionCommandContextActions = {
			getContextUsage: () => undefined,
			waitForIdle: async () => {
				await agent.waitForIdle();
			},
			newSession: async () => ({ cancelled: false }),
			branch: async () => ({ cancelled: false }),
			navigateTree: async () => ({ cancelled: false }),
			switchSession: async () => ({ cancelled: false }),
			reload: async () => {},
			compact: async () => {},
		};

		extensionRunner.initialize(
			loadResult.runtime, // ExtensionActions
			contextActions,
			commandActions,
			createNoOpUIContext(),
		);

		session = new AgentSession({
			agent,
			sessionManager,
			settings,
			extensionRunner,
			modelRegistry,
		});
	}

	it("should emit session_before_compact and session_compact events", async () => {
		const ext = createExtension();
		await createSession([ext]);

		await session.prompt("What is 2+2? Reply with just the number.");
		await session.agent.waitForIdle();

		await session.prompt("What is 3+3? Reply with just the number.");
		await session.agent.waitForIdle();

		await session.compact();

		const beforeEvents = capturedEvents.filter(
			(e): e is SessionBeforeCompactEvent => e.type === "session_before_compact",
		);
		const compactEvents = capturedEvents.filter((e): e is SessionCompactEvent => e.type === "session_compact");

		expect(beforeEvents.length).toBe(1);
		expect(compactEvents.length).toBe(1);

		const beforeEvent = beforeEvents[0]!;
		expect(beforeEvent.preparation).toBeDefined();
		expect(beforeEvent.preparation.messagesToSummarize).toBeDefined();
		expect(beforeEvent.preparation.turnPrefixMessages).toBeDefined();
		expect(beforeEvent.preparation.tokensBefore).toBeGreaterThanOrEqual(0);
		expect(typeof beforeEvent.preparation.isSplitTurn).toBe("boolean");
		expect(beforeEvent.branchEntries).toBeDefined();

		const afterEvent = compactEvents[0]!;
		expect(afterEvent.compactionEntry).toBeDefined();
		expect(afterEvent.compactionEntry.summary.length).toBeGreaterThan(0);
		expect(afterEvent.compactionEntry.tokensBefore).toBeGreaterThanOrEqual(0);
		expect(afterEvent.fromExtension).toBe(false);
	}, 120_000);

	it("should allow extensions to cancel compaction", async () => {
		const ext = createExtension(() => ({ cancel: true }));
		await createSession([ext]);

		await session.prompt("What is 2+2? Reply with just the number.");
		await session.agent.waitForIdle();

		await expect(session.compact()).rejects.toThrow("Compaction cancelled");

		const compactEvts = capturedEvents.filter(e => e.type === "session_compact");
		expect(compactEvts.length).toBe(0);
	}, 120_000);

	it("should allow extensions to provide custom compaction", async () => {
		const customSummary = "Custom summary from extension";
		const ext = createExtension(event => {
			if (event.type === "session_before_compact") {
				return {
					compaction: {
						summary: customSummary,
						firstKeptEntryId: event.preparation.firstKeptEntryId,
						tokensBefore: event.preparation.tokensBefore,
					},
				};
			}
			return undefined;
		});
		await createSession([ext]);

		await session.prompt("What is 2+2? Reply with just the number.");
		await session.agent.waitForIdle();

		await session.prompt("What is 3+3? Reply with just the number.");
		await session.agent.waitForIdle();

		const result = await session.compact();

		expect(result.summary).toBe(customSummary);

		const compactEvts = capturedEvents.filter((e): e is SessionCompactEvent => e.type === "session_compact");
		expect(compactEvts.length).toBe(1);
		expect(compactEvts[0]!.compactionEntry.summary).toBe(customSummary);
		expect(compactEvts[0]!.fromExtension).toBe(true);
	}, 120_000);

	it("should include compaction entry in session after compaction", async () => {
		const ext = createExtension();
		await createSession([ext]);

		await session.prompt("What is 2+2? Reply with just the number.");
		await session.agent.waitForIdle();

		await session.compact();

		const compactEvts = capturedEvents.filter((e): e is SessionCompactEvent => e.type === "session_compact");
		expect(compactEvts.length).toBe(1);

		const entries = session.sessionManager.getEntries();
		const hasCompaction = entries.some((e: { type: string }) => e.type === "compaction");
		expect(hasCompaction).toBe(true);
	}, 120_000);

	it("should call multiple extensions in registration order", async () => {
		const callOrder: string[] = [];

		const ext1: Extension = {
			path: "ext1",
			resolvedPath: "/test/ext1.ts",
			handlers: new Map<string, ((...args: unknown[]) => Promise<unknown>)[]>([
				[
					"session_before_compact",
					[
						async (_e: unknown) => {
							callOrder.push("ext1-before");
						},
					],
				],
				[
					"session_compact",
					[
						async (_e: unknown) => {
							callOrder.push("ext1-after");
						},
					],
				],
			]),
			tools: new Map(),
			messageRenderers: new Map(),
			commands: new Map(),
			flags: new Map(),
			shortcuts: new Map(),
		};

		const ext2: Extension = {
			path: "ext2",
			resolvedPath: "/test/ext2.ts",
			handlers: new Map<string, ((...args: unknown[]) => Promise<unknown>)[]>([
				[
					"session_before_compact",
					[
						async (_e: unknown) => {
							callOrder.push("ext2-before");
						},
					],
				],
				[
					"session_compact",
					[
						async (_e: unknown) => {
							callOrder.push("ext2-after");
						},
					],
				],
			]),
			tools: new Map(),
			messageRenderers: new Map(),
			commands: new Map(),
			flags: new Map(),
			shortcuts: new Map(),
		};

		await createSession([ext1, ext2]);

		await session.prompt("What is 2+2? Reply with just the number.");
		await session.agent.waitForIdle();

		await session.compact();

		expect(callOrder).toEqual(["ext1-before", "ext2-before", "ext1-after", "ext2-after"]);
	}, 120_000);

	it("should pass correct event data to session_before_compact handler", async () => {
		let capturedEvent: SessionBeforeCompactEvent | null = null;
		const ext = createExtension(event => {
			capturedEvent = event;
			return undefined;
		});
		await createSession([ext]);

		await session.prompt("What is 2+2? Reply with just the number.");
		await session.agent.waitForIdle();

		await session.prompt("What is 3+3? Reply with just the number.");
		await session.agent.waitForIdle();

		await session.compact();

		expect(capturedEvent).not.toBeNull();
		const ev = capturedEvent!;
		expect(typeof ev.preparation.isSplitTurn).toBe("boolean");
		expect(ev.preparation.firstKeptEntryId).toBeDefined();
		expect(Array.isArray(ev.preparation.messagesToSummarize)).toBe(true);
		expect(Array.isArray(ev.preparation.turnPrefixMessages)).toBe(true);
		expect(typeof ev.preparation.tokensBefore).toBe("number");
		expect(Array.isArray(ev.branchEntries)).toBe(true);
		expect(typeof session.sessionManager.getEntries).toBe("function");
		expect(typeof session.modelRegistry.getApiKey).toBe("function");
		const entries = session.sessionManager.getEntries();
		expect(Array.isArray(entries)).toBe(true);
		expect(entries.length).toBeGreaterThan(0);
	}, 120_000);
});
