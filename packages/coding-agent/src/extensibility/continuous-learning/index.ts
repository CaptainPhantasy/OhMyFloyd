/**
 * Continuous Learning v3 - Extension Factory
 *
 * Registers the continuous learning system as a built-in extension.
 * Subscribes to session, tool call, and tool result events to record
 * observations for pattern analysis. Registers slash commands for
 * instinct management.
 */

import type { ExtensionAPI } from "../extensions/types";
import { handleSessionEnd, handleSessionStart, handleToolCall, handleToolResult } from "./observer";
import {
	instinctAnalyzeCommand,
	instinctHealthCommand,
	instinctPromoteCommand,
	instinctPruneCommand,
	instinctStatusCommand,
} from "./commands";

// Re-export public API for external consumers
export { disableObserver, enableObserver, getObserverState, getStorage, refreshProjectContext } from "./observer";
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
 * Extension factory for the continuous learning system.
 * Called by the extension loader during session initialization.
 */
export function continuousLearningExtension(api: ExtensionAPI): void {
	// Event subscriptions
	api.on("session_start", async (_event, ctx) => {
		await handleSessionStart(ctx);
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

	// Slash commands
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
