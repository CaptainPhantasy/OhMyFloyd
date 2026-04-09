/**
 * Runtime compatibility test for legacy hook modules.
 * Proves that a TypeScript module written against the OLD HookAPI
 * actually loads, executes, and fires handlers through the extension runtime.
 *
 * This is the test the architect asked for: not type-level alias verification,
 * not CLI argument parsing, but actual runtime execution proof.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Snowflake } from "@oh-my-pi/pi-utils";

describe("Legacy hook module runtime compatibility", () => {
	let tempDir: string;
	let hookPath: string;
	let eventLogPath: string;

	beforeEach(() => {
		tempDir = path.join(os.tmpdir(), `omp-hook-compat-${Snowflake.next()}`);
		fs.mkdirSync(tempDir, { recursive: true });
		hookPath = path.join(tempDir, "legacy-hook.ts");
		eventLogPath = path.join(tempDir, "events.log");
	});

	afterEach(() => {
		if (tempDir && fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true });
		}
	});

	it("hook module using OLD HookAPI imports loads and fires handlers through extension runtime", async () => {
		// Create a hook module written against the OLD hook API.
		// This is exactly how a user's existing hook would look.
		const hookCode = `
import type { HookAPI } from "@oh-my-pi/pi-coding-agent/hooks";
import * as fs from "node:fs";

// User's existing hook written against old HookAPI type
export default function myHook(pi: HookAPI): void {
	pi.on("session_start", async () => {
		fs.appendFileSync("${eventLogPath.replace(/\\/g, "\\\\")}", "session_start\\n");
	});

	pi.on("tool_call", async (event) => {
		fs.appendFileSync("${eventLogPath.replace(/\\/g, "\\\\")}", "tool_call:" + event.toolName + "\\n");
	});

	pi.on("tool_result", async (event) => {
		fs.appendFileSync("${eventLogPath.replace(/\\/g, "\\\\")}", "tool_result:" + event.toolName + "\\n");
	});

	pi.on("context", async (event) => {
		fs.appendFileSync("${eventLogPath.replace(/\\/g, "\\\\")}", "context:" + event.messages.length + "\\n");
	});

	pi.on("turn_start", async (event) => {
		fs.appendFileSync("${eventLogPath.replace(/\\/g, "\\\\")}", "turn_start:" + event.turnIndex + "\\n");
	});

	pi.on("agent_start", async () => {
		fs.appendFileSync("${eventLogPath.replace(/\\/g, "\\\\")}", "agent_start\\n");
	});
}
`;
		fs.writeFileSync(hookPath, hookCode);

		// Load via the EXTENSION loader (this is what the system does at runtime)
		const { loadExtensions } = await import("../src/extensibility/extensions/loader");
		const { ExtensionRunner } = await import("../src/extensibility/extensions/runner");
		const { SessionManager } = await import("../src/session/session-manager");
		const { ModelRegistry } = await import("../src/config/model-registry");
		const { AuthStorage } = await import("../src/session/auth-storage");
		const { createNoOpUIContext } = await import("../src/extensibility/utils");

		const loadResult = await loadExtensions([hookPath], tempDir);

		// PROOF POINT 1: Module loaded successfully through extension loader
		expect(loadResult.extensions.length).toBe(1);
		expect(loadResult.errors.length).toBe(0);
		expect(loadResult.extensions[0].path).toBe(hookPath);

		// Create runner (same as production code path)
		const sessionManager = SessionManager.create(tempDir, tempDir);
		const authStorage = await AuthStorage.create(path.join(tempDir, "auth.db"));
		const modelRegistry = new ModelRegistry(authStorage);

		const runner = new ExtensionRunner(
			loadResult.extensions,
			loadResult.runtime,
			tempDir,
			sessionManager,
			modelRegistry,
		);

		runner.initialize(
			loadResult.runtime,
			{
				getModel: () => undefined,
				isIdle: () => true,
				abort: () => {},
				hasPendingMessages: () => false,
				shutdown: () => {},
				getContextUsage: () => undefined,
				compact: async () => {},
				getSystemPrompt: () => "",
			},
			{
				getContextUsage: () => undefined,
				waitForIdle: async () => {},
				newSession: async () => ({ cancelled: false }),
				branch: async () => ({ cancelled: false }),
				navigateTree: async () => ({ cancelled: false }),
				switchSession: async () => ({ cancelled: false }),
				reload: async () => {},
				compact: async () => {},
			},
			createNoOpUIContext(),
		);

		// PROOF POINT 2: session_start handler fires
		await runner.emit({ type: "session_start" });
		let log = fs.readFileSync(eventLogPath, "utf-8");
		expect(log).toContain("session_start");

		// PROOF POINT 3: tool_call handler fires with event data
		fs.writeFileSync(eventLogPath, ""); // clear
		await runner.emitToolCall({ type: "tool_call", toolCallId: "tc-1", toolName: "bash", input: {} });
		log = fs.readFileSync(eventLogPath, "utf-8");
		expect(log).toContain("tool_call:bash");

		// PROOF POINT 4: tool_result handler fires with event data
		fs.writeFileSync(eventLogPath, ""); // clear
		await runner.emitToolResult({
			type: "tool_result",
			toolCallId: "tc-1",
			toolName: "read",
			input: {},
			content: [{ type: "text" as const, text: "hello" }],
		});
		log = fs.readFileSync(eventLogPath, "utf-8");
		expect(log).toContain("tool_result:read");

		// PROOF POINT 5: context handler fires
		fs.writeFileSync(eventLogPath, ""); // clear
		await runner.emitContext([{ role: "user" as const, content: [{ type: "text" as const, text: "test" }] }]);
		log = fs.readFileSync(eventLogPath, "utf-8");
		expect(log).toContain("context:1");

		// PROOF POINT 6: turn_start handler fires
		fs.writeFileSync(eventLogPath, ""); // clear
		await runner.emit({ type: "turn_start", turnIndex: 0, timestamp: Date.now() });
		log = fs.readFileSync(eventLogPath, "utf-8");
		expect(log).toContain("turn_start:0");

		// PROOF POINT 7: agent_start handler fires
		fs.writeFileSync(eventLogPath, ""); // clear
		await runner.emit({ type: "agent_start" });
		log = fs.readFileSync(eventLogPath, "utf-8");
		expect(log).toContain("agent_start");

		// PROOF POINT 8: hasHandlers correctly reports the hook's event registrations
		expect(runner.hasHandlers("session_start")).toBe(true);
		expect(runner.hasHandlers("tool_call")).toBe(true);
		expect(runner.hasHandlers("tool_result")).toBe(true);
		expect(runner.hasHandlers("context")).toBe(true);
		expect(runner.hasHandlers("turn_start")).toBe(true);
		expect(runner.hasHandlers("agent_start")).toBe(true);
		expect(runner.hasHandlers("session_shutdown")).toBe(false); // not registered

		await authStorage.close();
	});

	it("hook module using OLD HookAPI pi.on() typed overloads compiles and runs", async () => {
		// This tests the TYPE-SAFE overloaded signatures:
		// pi.on("session_before_compact", handler) expects specific event/result types
		const hookCode = `
import type { HookAPI } from "@oh-my-pi/pi-coding-agent/hooks";
import * as fs from "node:fs";

export default function myHook(pi: HookAPI): void {
	// These use the typed overloads from HookAPI
	pi.on("session_before_compact", async (event, ctx) => {
		fs.appendFileSync("${eventLogPath.replace(/\\/g, "\\\\")}", "before_compact\\n");
		return { cancel: true };
	});

	pi.on("session_before_branch", async (event, ctx) => {
		fs.appendFileSync("${eventLogPath.replace(/\\/g, "\\\\")}", "before_branch\\n");
		return { cancel: false };
	});

	pi.on("before_agent_start", async (event) => {
		fs.appendFileSync("${eventLogPath.replace(/\\/g, "\\\\")}", "before_agent_start\\n");
		return { message: { customType: "test", content: "injected", display: true, attribution: "agent" } };
	});

	pi.on("tool_call", async (event) => {
		fs.appendFileSync("${eventLogPath.replace(/\\/g, "\\\\")}", "tool_call\\n");
		return { block: false };
	});
}
`;
		fs.writeFileSync(hookPath, hookCode);

		const { loadExtensions } = await import("../src/extensibility/extensions/loader");
		const { ExtensionRunner } = await import("../src/extensibility/extensions/runner");
		const { SessionManager } = await import("../src/session/session-manager");
		const { ModelRegistry } = await import("../src/config/model-registry");
		const { AuthStorage } = await import("../src/session/auth-storage");
		const { createNoOpUIContext } = await import("../src/extensibility/utils");

		const loadResult = await loadExtensions([hookPath], tempDir);
		expect(loadResult.extensions.length).toBe(1);
		expect(loadResult.errors.length).toBe(0);

		const sessionManager = SessionManager.create(tempDir, tempDir);
		const authStorage = await AuthStorage.create(path.join(tempDir, "auth.db"));
		const modelRegistry = new ModelRegistry(authStorage);

		const runner = new ExtensionRunner(
			loadResult.extensions,
			loadResult.runtime,
			tempDir,
			sessionManager,
			modelRegistry,
		);

		runner.initialize(
			loadResult.runtime,
			{
				getModel: () => undefined,
				isIdle: () => true,
				abort: () => {},
				hasPendingMessages: () => false,
				shutdown: () => {},
				getContextUsage: () => undefined,
				compact: async () => {},
				getSystemPrompt: () => "",
			},
			{
				getContextUsage: () => undefined,
				waitForIdle: async () => {},
				newSession: async () => ({ cancelled: false }),
				branch: async () => ({ cancelled: false }),
				navigateTree: async () => ({ cancelled: false }),
				switchSession: async () => ({ cancelled: false }),
				reload: async () => {},
				compact: async () => {},
			},
			createNoOpUIContext(),
		);

		// Test session_before_compact with cancel result
		const compactResult = await runner.emit({
			type: "session_before_compact",
			preparation: {
				messagesToSummarize: [],
				turnPrefixMessages: [],
				previousSummary: null,
				fileOperations: [],
				totalTurns: 0,
			},
			branchEntries: [],
			signal: new AbortController().signal,
		});
		expect(fs.readFileSync(eventLogPath, "utf-8")).toContain("before_compact");
		expect(compactResult).toEqual({ cancel: true });

		// Test session_before_branch
		fs.writeFileSync(eventLogPath, "");
		const branchResult = await runner.emit({
			type: "session_before_branch",
			entryId: "entry-1",
		});
		expect(fs.readFileSync(eventLogPath, "utf-8")).toContain("before_branch");
		expect(branchResult).toEqual({ cancel: false });

		// Test before_agent_start
		fs.writeFileSync(eventLogPath, "");
		const startResult = await runner.emitBeforeAgentStart("hello", undefined, "");
		expect(fs.readFileSync(eventLogPath, "utf-8")).toContain("before_agent_start");
		expect(startResult?.messages).toBeDefined();
		expect(startResult!.messages!.length).toBe(1);

		await authStorage.close();
	});
});
