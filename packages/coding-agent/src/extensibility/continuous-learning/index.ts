/**
 * Continuous Learning v3 - Extension Factory
 *
 * Registers the continuous learning system as a built-in extension.
 *
 * Enforcement chain:
 *   session_start → load active instincts into cache
 *   tool_call / tool_result → record observations, trigger background analysis
 *   context → inject active instincts as enforcement rules into the message stream
 *   session_shutdown → flush final observations
 *
 * The context handler is the enforcement mechanism. It prepends a developer
 * message containing all active instincts before every model invocation.
 * The model sees these as binding rules, not suggestions.
 */

import type { ExtensionAPI } from "../extensions/types";
import {
	getActiveInstincts,
	handleSessionEnd,
	handleSessionStart,
	handleToolCall,
	handleToolResult,
	reloadActiveInstincts,
} from "./observer";
import {
	instinctAnalyzeCommand,
	instinctHealthCommand,
	instinctPromoteCommand,
	instinctPruneCommand,
	instinctStatusCommand,
} from "./commands";

// Re-export public API for external consumers
export {
	disableObserver,
	enableObserver,
	getActiveInstincts,
	getObserverState,
	getStorage,
	reloadActiveInstincts,
	refreshProjectContext,
} from "./observer";
export { analyzeObservations, promoteInstincts, pruneExpiredInstincts } from "./pattern-detector";
export { ContinuousLearningStorage, computeChecksum, isoTimestamp, redactSecrets, uuid } from "./storage";
export type {
	AnalysisResult,
	AuditLogEntry,
	AuditOperation,
	ContinuousLearningConfig,
	HealthCheckResult,
	Instinct,
	InstinctDomain,
	InstinctScope,
	InstinctSource,
	InstinctStatus,
	Observation,
	ObservationEvent,
	PatternCandidate,
	ProjectContext,
} from "./types";

/**
 * Build the enforcement text block from active instincts.
 * Returns undefined if no instincts are active (no enforcement needed).
 */
function buildEnforcementBlock(instincts: import("./types").Instinct[]): string | undefined {
	if (instincts.length === 0) return undefined;

	const lines: string[] = [
		"<learned-rules>",
		"The following rules were learned from prior sessions. They are mandatory.",
		"Violating them is a defect. Each rule was derived from observed behavior",
		"that caused problems and must not recur.",
		"",
	];

	for (const instinct of instincts) {
		const scope = instinct.scope === "global" ? "[GLOBAL]" : "[PROJECT]";
		const confidence = Math.round(instinct.confidence * 100);
		lines.push(`${scope} ${instinct.id} (${confidence}% confidence)`);
		lines.push(`  WHEN: ${instinct.trigger}`);
		lines.push(`  THEN: ${instinct.action}`);
		lines.push("");
	}

	lines.push("</learned-rules>");
	return lines.join("\n");
}

/**
 * Extension factory for the continuous learning system.
 * Called by the extension loader during session initialization.
 */
export function continuousLearningExtension(api: ExtensionAPI): void {
	// =========================================================================
	// Observation: capture events for pattern analysis
	// =========================================================================

	api.on("session_start", async (_event, ctx) => {
		await handleSessionStart(ctx);
		// Load active instincts into cache for enforcement
		await reloadActiveInstincts();
	});

	api.on("tool_call", async (event, ctx) => {
		await handleToolCall(event, ctx);
	});

	api.on("tool_result", async (event, ctx) => {
		// Map ToolResultEvent fields to observer's expected shape
		const textContent = event.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map(c => c.text)
			.join("\n");
		await handleToolResult(
			{
				tool: event.toolName,
				toolUseId: event.toolCallId,
				output: textContent || undefined,
				error: event.isError ? textContent : undefined,
			},
			ctx,
		);
	});

	api.on("session_shutdown", async (_event, ctx) => {
		await handleSessionEnd(ctx);
	});

	// =========================================================================
	// Enforcement: inject learned rules into the model's context
	// =========================================================================

	api.on("context", event => {
		const instincts = getActiveInstincts();
		const enforcementBlock = buildEnforcementBlock(instincts);
		if (!enforcementBlock) return;

		// Prepend a developer message containing the enforcement rules.
		// The model sees this before all user/assistant messages, making the
		// rules as authoritative as the system prompt.
		const enforcementMessage = {
			role: "developer" as const,
			content: [{ type: "text" as const, text: enforcementBlock }],
			attribution: "agent" as const,
			timestamp: Date.now(),
		};

		return { messages: [enforcementMessage, ...event.messages] };
	});

	// =========================================================================
	// Slash commands for manual control
	// =========================================================================

	api.registerCommand("instinct-status", {
		description: "Show continuous learning status and instincts",
		handler: async (args, ctx) => {
			const result = await instinctStatusCommand(args.split(/\s+/).filter(Boolean), ctx);
			if (result) {
				ctx.ui.notify(result, "info");
			}
		},
	});

	api.registerCommand("instinct-analyze", {
		description: "Analyze observations and detect patterns",
		handler: async (args, ctx) => {
			const result = await instinctAnalyzeCommand(args.split(/\s+/).filter(Boolean), ctx);
			if (result) {
				ctx.ui.notify(result, "info");
			}
		},
	});

	api.registerCommand("instinct-health", {
		description: "Run health check on continuous learning storage",
		handler: async (args, ctx) => {
			const result = await instinctHealthCommand(args.split(/\s+/).filter(Boolean), ctx);
			if (result) {
				ctx.ui.notify(result, "info");
			}
		},
	});

	api.registerCommand("instinct-prune", {
		description: "Remove expired pending instincts",
		handler: async (args, ctx) => {
			const result = await instinctPruneCommand(args.split(/\s+/).filter(Boolean), ctx);
			if (result) {
				ctx.ui.notify(result, "info");
			}
		},
	});

	api.registerCommand("instinct-promote", {
		description: "Promote project instincts to global scope",
		handler: async (args, ctx) => {
			const result = await instinctPromoteCommand(args.split(/\s+/).filter(Boolean), ctx);
			if (result) {
				ctx.ui.notify(result, "info");
			}
		},
	});
}
