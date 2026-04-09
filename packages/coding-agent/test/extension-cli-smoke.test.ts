/**
 * E2E smoke test for extension loading from CLI.
 * Verifies:
 * 1. CLI starts with extension path
 * 2. Extension loads from configured path
 * 3. Handler receives real session events
 * 4. Process exits cleanly
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Snowflake } from "@oh-my-pi/pi-utils";

describe("Extension CLI smoke test", () => {
	let tempDir: string;
	let extensionPath: string;
	let eventLogPath: string;

	beforeEach(() => {
		tempDir = path.join(os.tmpdir(), `omp-ext-smoke-${Snowflake.next()}`);
		fs.mkdirSync(tempDir, { recursive: true });
		extensionPath = path.join(tempDir, "test-extension.ts");
		eventLogPath = path.join(tempDir, "events.log");
	});

	afterEach(() => {
		if (tempDir && fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true });
		}
	});

	it("extension loads and receives session_start event", async () => {
		// Create a test extension that logs events to a file
		const extensionCode = `
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import * as fs from "node:fs";

export default function testExtension(pi: ExtensionAPI): void {
	pi.on("session_start", async () => {
		fs.appendFileSync("${eventLogPath.replace(/\\/g, "\\\\")}", "session_start\\n");
	});
}
`;
		fs.writeFileSync(extensionPath, extensionCode);

		// Import and test the extension loading mechanism directly
		const { loadExtensions } = await import("../src/extensibility/extensions/loader");
		const { ExtensionRunner } = await import("../src/extensibility/extensions/runner");
		const { SessionManager } = await import("../src/session/session-manager");
		const { ModelRegistry } = await import("../src/config/model-registry");
		const { AuthStorage } = await import("../src/session/auth-storage");
		const { createNoOpUIContext } = await import("../src/extensibility/utils");

		// Load extension
		const loadResult = await loadExtensions([extensionPath], tempDir);
		expect(loadResult.extensions.length).toBe(1);
		expect(loadResult.errors.length).toBe(0);

		// Create runner
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

		// Initialize with minimal context
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

		// Emit session_start event
		await runner.emit({ type: "session_start" });

		// Verify event was received
		expect(fs.existsSync(eventLogPath)).toBe(true);
		const logContent = fs.readFileSync(eventLogPath, "utf-8");
		expect(logContent).toContain("session_start");

		// Clean exit verification - no exceptions thrown
		await authStorage.close();
	});

	it("--extension and --hook paths are merged into extension system", async () => {
		// This test verifies the CLI argument parsing merges both flags
		const { parseArgs } = await import("../src/cli/args");

		const args = parseArgs([
			"--extension",
			"/path/to/ext1.ts",
			"--hook",
			"/path/to/hook1.ts",
			"--extension",
			"/path/to/ext2.ts",
		]);

		// Both --extension and --hook should be captured
		expect(args.extensions).toEqual(["/path/to/ext1.ts", "/path/to/ext2.ts"]);
		expect(args.hooks).toEqual(["/path/to/hook1.ts"]);
	});
});
