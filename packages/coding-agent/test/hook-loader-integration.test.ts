/**
 * Integration tests for the HookLoader system.
 *
 * Tests that:
 * - HookLoader initializes correctly from ~/.omp/hooks/
 * - Bash commands are correctly checked against hook rules
 * - Block/warn actions work as expected
 * - Message templates are replaced
 * - Invalid patterns are handled gracefully
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { TempDir } from "@oh-my-pi/pi-utils";
import { HookLoader, type HookRule } from "../src/config/hook-loader";

describe("HookLoader Integration Tests", () => {
	let tempDir: TempDir;
	let hooksDir: string;
	let originalHome: string | undefined;

	beforeEach(async () => {
		// Create temp directory for testing
		tempDir = TempDir.createSync("@pi-hook-loader-test-");

		// Set up fake HOME directory with hooks
		originalHome = process.env.HOME;
		process.env.HOME = tempDir.path();
		hooksDir = path.join(tempDir.path(), ".omp", "hooks");
		await fs.promises.mkdir(hooksDir, { recursive: true });
	});

	afterEach(async () => {
		// Restore HOME
		if (originalHome !== undefined) {
			process.env.HOME = originalHome;
		} else {
			delete process.env.HOME;
		}

		// Clean up temp directory
		tempDir.removeSync();

		// Reset HookLoader singleton for next test
		const hookLoader = HookLoader.getInstance();
		// @ts-expect-error - accessing private field for testing
		hookLoader.rules = [];
		// @ts-expect-error - accessing private field for testing
		hookLoader.initialized = false;
		// @ts-expect-error - accessing private static field for testing
		HookLoader.instance = undefined;
	});

	/**
	 * Write hook rules to the hooks directory
	 */
	async function writeHookRules(filename: string, rules: HookRule[]): Promise<void> {
		const filePath = path.join(hooksDir, filename);
		await fs.promises.writeFile(filePath, JSON.stringify(rules, null, 2));
	}

	describe("HookLoader Initialization", () => {
		it("loads hook rules from ~/.omp/hooks/ directory", async () => {
			const rules: HookRule[] = [
				{
					hook_name: "test-rule",
					event: "PreToolUse",
					description: "Test rule",
					pattern: "rm -rf",
					action: "block",
					message: "Blocked!",
				},
			];
			await writeHookRules("test.json", rules);

			const hookLoader = HookLoader.getInstance();
			await hookLoader.initialize();

			expect(hookLoader.getRulesCount()).toBe(1);
			expect(hookLoader.getRules()[0].hook_name).toBe("test-rule");
		});

		it("loads multiple hook files from ~/.omp/hooks/", async () => {
			const rules1: HookRule[] = [
				{
					hook_name: "rule-1",
					event: "PreToolUse",
					description: "First rule",
					pattern: "rm",
					action: "block",
				},
			];

			const rules2: HookRule[] = [
				{
					hook_name: "rule-2",
					event: "PreToolUse",
					description: "Second rule",
					pattern: "sudo",
					action: "warn",
				},
			];

			await writeHookRules("destructive.json", rules1);
			await writeHookRules("warnings.json", rules2);

			const hookLoader = HookLoader.getInstance();
			await hookLoader.initialize();

			expect(hookLoader.getRulesCount()).toBe(2);
			const ruleNames = hookLoader.getRules().map(r => r.hook_name);
			expect(ruleNames).toContain("rule-1");
			expect(ruleNames).toContain("rule-2");
		});

		it("handles missing hooks directory gracefully", async () => {
			// Delete the hooks directory
			await fs.promises.rm(hooksDir, { recursive: true, force: true });

			const hookLoader = HookLoader.getInstance();
			await hookLoader.initialize();

			expect(hookLoader.getRulesCount()).toBe(0);
		});

		it("handles malformed JSON files gracefully", async () => {
			await fs.promises.writeFile(path.join(hooksDir, "malformed.json"), "{ invalid json }");

			const hookLoader = HookLoader.getInstance();
			await hookLoader.initialize();

			// Should not crash, just skip the malformed file
			expect(hookLoader.getRulesCount()).toBe(0);
		});
	});

	describe("Bash Command Checking", () => {
		it("matches destructive commands with block action", async () => {
			const blockRule: HookRule[] = [
				{
					hook_name: "block-rm-rf",
					event: "PreToolUse",
					description: "Prevent accidental deletion",
					pattern: String.raw`rm\s+-rf`,
					action: "block",
					message: "Command '{{ command }}' is blocked for safety",
				},
			];
			await writeHookRules("safety.json", blockRule);

			const hookLoader = HookLoader.getInstance();
			await hookLoader.initialize();

			const result = hookLoader.checkBashCommand("rm -rf /important");

			expect(result.matched).toBe(true);
			expect(result.rule).toBeDefined();
			expect(result.rule?.action).toBe("block");
			expect(result.message).toContain("{{ command }}");
		});

		it("matches commands with warn action", async () => {
			const warnRule: HookRule[] = [
				{
					hook_name: "warn-sudo",
					event: "PreToolUse",
					description: "Warn on sudo usage",
					pattern: String.raw`^sudo\s`,
					action: "warn",
					message: "Warning: '{{ command }}' uses sudo",
				},
			];
			await writeHookRules("warnings.json", warnRule);

			const hookLoader = HookLoader.getInstance();
			await hookLoader.initialize();

			const result = hookLoader.checkBashCommand("sudo ls");

			expect(result.matched).toBe(true);
			expect(result.rule).toBeDefined();
			expect(result.rule?.action).toBe("warn");
			expect(result.message).toContain("{{ command }}");
		});

		it("allows safe commands through without matching", async () => {
			const blockRule: HookRule[] = [
				{
					hook_name: "block-dangerous",
					event: "PreToolUse",
					description: "Block dangerous commands",
					pattern: String.raw`rm\s+-rf|mkfs|dd\s+if=`,
					action: "block",
				},
			];
			await writeHookRules("safety.json", blockRule);

			const hookLoader = HookLoader.getInstance();
			await hookLoader.initialize();

			const result = hookLoader.checkBashCommand("ls -la");

			expect(result.matched).toBe(false);
			expect(result.rule).toBeUndefined();
		});

		it("preserves {{ command }} template in message", async () => {
			const rule: HookRule[] = [
				{
					hook_name: "block-format",
					event: "PreToolUse",
					description: "Test message formatting",
					pattern: "test-command",
					action: "block",
					message: "Blocked command: {{ command }}",
				},
			];
			await writeHookRules("format.json", rule);

			const hookLoader = HookLoader.getInstance();
			await hookLoader.initialize();

			const result = hookLoader.checkBashCommand("test-command arg1 arg2");

			expect(result.matched).toBe(true);
			expect(result.message).toBe("Blocked command: {{ command }}");
		});
	});

	describe("Hook Pattern Matching", () => {
		it("matches regex patterns correctly", async () => {
			const rules: HookRule[] = [
				{
					hook_name: "block-force-flags",
					event: "PreToolUse",
					description: "Block force flags",
					pattern: String.raw`git\s+push\s+.*--force`,
					action: "block",
					message: "Force push blocked",
				},
			];
			await writeHookRules("git.json", rules);

			const hookLoader = HookLoader.getInstance();
			await hookLoader.initialize();

			// Should match force push
			const blocked = hookLoader.checkBashCommand("git push origin main --force");
			expect(blocked.matched).toBe(true);

			// Should not match normal push
			const allowed = hookLoader.checkBashCommand("git push origin main");
			expect(allowed.matched).toBe(false);
		});

		it("returns first matching rule when multiple rules match", async () => {
			const rules: HookRule[] = [
				{
					hook_name: "block-rm",
					event: "PreToolUse",
					description: "Block rm",
					pattern: String.raw`^rm\s`,
					action: "block",
					message: "rm blocked",
				},
				{
					hook_name: "warn-rm",
					event: "PreToolUse",
					description: "Warn rm",
					pattern: String.raw`^rm\s`,
					action: "warn",
					message: "rm warning",
				},
			];
			await writeHookRules("multi.json", rules);

			const hookLoader = HookLoader.getInstance();
			await hookLoader.initialize();

			const result = hookLoader.checkBashCommand("rm test.txt");

			expect(result.matched).toBe(true);
			expect(result.rule?.hook_name).toBe("block-rm");
			expect(result.message).toBe("rm blocked");
		});

		it("handles invalid regex patterns gracefully", async () => {
			const rules: HookRule[] = [
				{
					hook_name: "invalid-pattern",
					event: "PreToolUse",
					description: "Invalid regex",
					pattern: "[invalid(regex",
					action: "block",
				},
				{
					hook_name: "valid-pattern",
					event: "PreToolUse",
					description: "Valid pattern",
					pattern: "test",
					action: "block",
				},
			];
			await writeHookRules("invalid.json", rules);

			const hookLoader = HookLoader.getInstance();
			await hookLoader.initialize();

			// Should skip invalid pattern and check valid one
			const result = hookLoader.checkBashCommand("test command");

			expect(result.matched).toBe(true);
			expect(result.rule?.hook_name).toBe("valid-pattern");
		});
	});

	describe("Edge Cases", () => {
		it("handles empty command string", async () => {
			const rules: HookRule[] = [
				{
					hook_name: "test-rule",
					event: "PreToolUse",
					description: "Test",
					pattern: ".*",
					action: "block",
				},
			];
			await writeHookRules("test.json", rules);

			const hookLoader = HookLoader.getInstance();
			await hookLoader.initialize();

			const result = hookLoader.checkBashCommand("");

			expect(result.matched).toBe(true);
		});

		it("returns undefined message when message field is missing", async () => {
			const rules: HookRule[] = [
				{
					hook_name: "no-message-block",
					event: "PreToolUse",
					description: "Block without custom message",
					pattern: "test-block",
					action: "block",
				},
			];
			await writeHookRules("default-msg.json", rules);

			const hookLoader = HookLoader.getInstance();
			await hookLoader.initialize();

			const result = hookLoader.checkBashCommand("test-block");

			expect(result.matched).toBe(true);
			expect(result.message).toBeUndefined();
		});

		it("filters only PreToolUse events", async () => {
			const rules: HookRule[] = [
				{
					hook_name: "post-tool-rule",
					event: "PostToolUse",
					description: "Post-tool rule",
					pattern: "test",
					action: "block",
				},
				{
					hook_name: "pre-tool-rule",
					event: "PreToolUse",
					description: "Pre-tool rule",
					pattern: "test",
					action: "block",
				},
			];
			await writeHookRules("events.json", rules);

			const hookLoader = HookLoader.getInstance();
			await hookLoader.initialize();

			const result = hookLoader.checkBashCommand("test command");

			// Should only match PreToolUse rule
			expect(result.matched).toBe(true);
			expect(result.rule?.hook_name).toBe("pre-tool-rule");
		});

		it("handles non-string event types", async () => {
			const rules: HookRule[] = [
				{
					hook_name: "custom-event",
					event: "CustomEvent" as any,
					description: "Custom event",
					pattern: "test",
					action: "block",
				},
			];
			await writeHookRules("custom.json", rules);

			const hookLoader = HookLoader.getInstance();
			await hookLoader.initialize();

			const result = hookLoader.checkBashCommand("test");

			// Should not match non-PreToolUse events
			expect(result.matched).toBe(false);
		});
	});
});
