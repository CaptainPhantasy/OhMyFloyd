/**
 * Contract tests for extension events.
 * Verifies every documented event in ExtensionAPI has a production emitter in ExtensionRunner.
 *
 * Rule: No event can exist in ExtensionAPI without a corresponding emit method in ExtensionRunner.
 */

import { describe, expect, it } from "bun:test";
import { ExtensionRunner } from "../src/extensibility/extensions/runner";

/**
 * All events documented in ExtensionAPI.on() signatures.
 * This list must match the ExtensionAPI interface in types.ts.
 */
const DOCUMENTED_EVENTS = [
	// Session lifecycle
	"session_start",
	"session_before_switch",
	"session_switch",
	"session_before_branch",
	"session_branch",
	"session_before_compact",
	"session.compacting",
	"session_compact",
	"session_shutdown",
	"session_before_tree",
	"session_tree",
	// Context and agent
	"context",
	"before_provider_request",
	"before_agent_start",
	"agent_start",
	"agent_end",
	"turn_start",
	"turn_end",
	// Message streaming
	"message_start",
	"message_update",
	"message_end",
	// Tool execution
	"tool_execution_start",
	"tool_execution_update",
	"tool_execution_end",
	// Auto operations
	"auto_compaction_start",
	"auto_compaction_end",
	"auto_retry_start",
	"auto_retry_end",
	// Notifications
	"ttsr_triggered",
	"todo_reminder",
	// Input/tool
	"input",
	"tool_call",
	"tool_result",
	// User commands
	"user_bash",
	"user_python",
] as const;

/**
 * Map of event names to their corresponding emit method names in ExtensionRunner.
 * Format: eventName -> emitMethodName
 */
const EVENT_EMITTERS: Record<string, string> = {
	// Generic emit() handles most events
	session_start: "emit",
	session_before_switch: "emit",
	session_switch: "emit",
	session_before_branch: "emit",
	session_branch: "emit",
	session_before_compact: "emit",
	"session.compacting": "emit",
	session_compact: "emit",
	session_shutdown: "emit",
	session_before_tree: "emit",
	session_tree: "emit",
	before_agent_start: "emitBeforeAgentStart",
	agent_start: "emit",
	agent_end: "emit",
	turn_start: "emit",
	turn_end: "emit",
	message_start: "emit",
	message_update: "emit",
	message_end: "emit",
	tool_execution_start: "emit",
	tool_execution_update: "emit",
	tool_execution_end: "emit",
	auto_compaction_start: "emit",
	auto_compaction_end: "emit",
	auto_retry_start: "emit",
	auto_retry_end: "emit",
	ttsr_triggered: "emit",
	todo_reminder: "emit",
	// Specialized emitters
	context: "emitContext",
	before_provider_request: "emitBeforeProviderRequest",
	input: "emitInput",
	tool_call: "emitToolCall",
	tool_result: "emit",
	user_bash: "emitUserBash",
	user_python: "emitUserPython",
};

describe("Extension event contract", () => {
	it("every documented event has an emit method in ExtensionRunner", () => {
		const runnerMethods = Object.getOwnPropertyNames(ExtensionRunner.prototype);
		const missingEmitters: string[] = [];

		for (const event of DOCUMENTED_EVENTS) {
			const emitterMethod = EVENT_EMITTERS[event];
			if (!emitterMethod) {
				missingEmitters.push(`${event}: no emitter mapping defined`);
				continue;
			}
			if (!runnerMethods.includes(emitterMethod)) {
				missingEmitters.push(`${event}: emitter '${emitterMethod}' not found in ExtensionRunner`);
			}
		}

		expect(missingEmitters).toEqual([]);
	});

	it("ExtensionRunner.emit handles generic events", () => {
		expect(typeof ExtensionRunner.prototype.emit).toBe("function");
	});

	it("ExtensionRunner has specialized emitters for context-modifying events", () => {
		const specializedEmitters = [
			"emitContext",
			"emitBeforeAgentStart",
			"emitBeforeProviderRequest",
			"emitInput",
			"emitToolCall",
			"emitUserBash",
			"emitUserPython",
		];

		const runnerMethods = Object.getOwnPropertyNames(ExtensionRunner.prototype);
		const missing = specializedEmitters.filter(m => !runnerMethods.includes(m));

		expect(missing).toEqual([]);
	});

	it("all event emitter mappings are defined", () => {
		const unmapped = DOCUMENTED_EVENTS.filter(e => !EVENT_EMITTERS[e]);
		expect(unmapped).toEqual([]);
	});
});
