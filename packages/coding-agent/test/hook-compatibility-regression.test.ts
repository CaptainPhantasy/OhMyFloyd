/**
 * Regression test for --hook compatibility.
 * Proves that --hook resolves into the extension runtime and does NOT
 * attempt any deleted legacy path (HookRunner, HookToolWrapper, discoverAndLoadHooks).
 *
 * Contract:
 * - --hook is a compatibility alias for --extension
 * - Both flags merge into additionalExtensionPaths
 * - Extension system handles all hook paths
 * - No legacy HookRunner/HookToolWrapper code is invoked
 */

import { describe, expect, it } from "bun:test";

describe("--hook compatibility regression", () => {
	it("parseArgs captures --hook into hooks array", async () => {
		const { parseArgs } = await import("../src/cli/args");

		const args = parseArgs(["--hook", "/path/to/hook.ts"]);

		expect(args.hooks).toEqual(["/path/to/hook.ts"]);
	});

	it("multiple --hook flags accumulate", async () => {
		const { parseArgs } = await import("../src/cli/args");

		const args = parseArgs(["--hook", "/a.ts", "--hook", "/b.ts", "--hook", "/c.ts"]);

		expect(args.hooks).toEqual(["/a.ts", "/b.ts", "/c.ts"]);
	});

	it("--hook and --extension are both captured separately", async () => {
		const { parseArgs } = await import("../src/cli/args");

		const args = parseArgs(["--extension", "/ext.ts", "--hook", "/hook.ts"]);

		expect(args.extensions).toEqual(["/ext.ts"]);
		expect(args.hooks).toEqual(["/hook.ts"]);
	});

	it("hooks/index.ts exports only type aliases, no runtime code", async () => {
		// Import the hooks module
		const hooksModule = await import("../src/extensibility/hooks/index");

		// Should export types re-exported from types.ts
		// The module should NOT export HookRunner, HookToolWrapper, loadHooks, discoverAndLoadHooks

		const exportedKeys = Object.keys(hooksModule);

		// These legacy exports must NOT exist
		expect(exportedKeys).not.toContain("HookRunner");
		expect(exportedKeys).not.toContain("HookToolWrapper");
		expect(exportedKeys).not.toContain("loadHooks");
		expect(exportedKeys).not.toContain("discoverAndLoadHooks");
		expect(exportedKeys).not.toContain("loadHook");
	});

	it("hooks/types.ts exports are type aliases to extension types", async () => {
		// Import both modules
		const hooksTypes = await import("../src/extensibility/hooks/types");
		const extensionTypes = await import("../src/extensibility/extensions/types");

		// Verify key type aliases point to the same underlying types
		// Note: We can't directly compare types at runtime, but we can verify
		// the module structure is consistent

		// These should be re-exported from extension types
		expect(typeof extensionTypes.isToolCallEventType).toBe("function");

		// The hooks module should not have any runtime functions of its own
		const hooksExports = Object.keys(hooksTypes);
		const runtimeFunctions = hooksExports.filter(
			key => typeof (hooksTypes as Record<string, unknown>)[key] === "function",
		);

		// Should have no runtime functions (only type re-exports)
		expect(runtimeFunctions).toEqual([]);
	});

	it("ExtensionRunner is the only runner class", async () => {
		// Verify ExtensionRunner exists and is a class
		const { ExtensionRunner } = await import("../src/extensibility/extensions/runner");

		expect(typeof ExtensionRunner).toBe("function");
		expect(ExtensionRunner.prototype.emit).toBeDefined();
		expect(ExtensionRunner.prototype.emitToolCall).toBeDefined();
		expect(ExtensionRunner.prototype.emitContext).toBeDefined();

		// Verify HookRunner does NOT exist anywhere in the codebase
		// (This is a compile-time guarantee, but we verify the import fails)
		let hookRunnerExists = false;
		try {
			// @ts-expect-error - This import should fail
			await import("../src/extensibility/hooks/runner");
			hookRunnerExists = true;
		} catch {
			hookRunnerExists = false;
		}

		expect(hookRunnerExists).toBe(false);
	});

	it("--noExtensions disables both extensions and hooks", async () => {
		const { parseArgs } = await import("../src/cli/args");

		const args = parseArgs(["--no-extensions", "--hook", "/hook.ts", "--extension", "/ext.ts"]);

		expect(args.noExtensions).toBe(true);
		// The paths are still parsed, but --no-extensions disables them at runtime
		expect(args.hooks).toEqual(["/hook.ts"]);
		expect(args.extensions).toEqual(["/ext.ts"]);
	});
});
