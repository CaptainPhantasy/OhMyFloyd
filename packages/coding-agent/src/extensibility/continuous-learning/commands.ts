/**
 * Continuous Learning v3 - Slash Commands
 *
 * CLI commands for managing instincts and observing learning state.
 */

import type { HookCommandContext } from "../hooks/types";
import { getObserverState, getStorage } from "./observer";
import { analyzeObservations, promoteInstincts, pruneExpiredInstincts } from "./pattern-detector";
import { ContinuousLearningStorage } from "./storage";
import type { Instinct } from "./types";

// ============================================================================
// Command: /instinct-status
// ============================================================================

export async function instinctStatusCommand(_args: string[], _ctx: HookCommandContext): Promise<string | undefined> {
	const observerState = getObserverState();
	let storage = getStorage();

	if (!storage) {
		storage = new ContinuousLearningStorage();
		await storage.initialize();
	}

	const config = storage.getConfig();
	const projectId = observerState.projectId ?? "global";
	const instincts = await storage.readAllInstincts(projectId);
	const observations = await storage.readObservations(projectId);
	const projects = await storage.readProjectRegistry();

	// Group by scope and status
	const projectInstincts = instincts.filter(i => i.scope === "project");
	const globalInstincts = instincts.filter(i => i.scope === "global");
	const pending = instincts.filter(i => i.status === "pending");
	const active = instincts.filter(i => i.status === "active");

	// Build report
	const lines: string[] = [];
	lines.push("# Continuous Learning Status\n");
	lines.push(`**Schema Version:** ${config.schemaVersion ?? "3.0.0"}`);
	lines.push(`**Observer Enabled:** ${observerState.enabled ? "Yes" : "No"}`);
	lines.push(`**Session ID:** ${observerState.sessionId}`);
	lines.push(`**Observations This Session:** ${observerState.observationCount}`);
	lines.push("");

	lines.push("## Project Context");
	lines.push(`- **Project:** ${observerState.projectName ?? "global"} (${observerState.projectId ?? "global"})`);
	lines.push(`- **Total Observations:** ${observations.length}`);
	lines.push(`- **Projects Tracked:** ${Object.keys(projects).length}`);
	lines.push("");

	lines.push("## Instinct Summary");
	lines.push(`- **Total Instincts:** ${instincts.length}`);
	lines.push(`- **Project-Scoped:** ${projectInstincts.length}`);
	lines.push(`- **Global:** ${globalInstincts.length}`);
	lines.push(`- **Active:** ${active.length}`);
	lines.push(`- **Pending Review:** ${pending.length}`);
	lines.push("");

	// Group by domain
	const byDomain: Record<string, Instinct[]> = {};
	for (const instinct of active) {
		const domain = instinct.domain;
		byDomain[domain] = byDomain[domain] ?? [];
		byDomain[domain].push(instinct);
	}

	if (active.length > 0) {
		lines.push("## Active Instincts by Domain\n");
		for (const [domain, domainInstincts] of Object.entries(byDomain).sort()) {
			lines.push(`### ${domain.toUpperCase()} (${domainInstincts.length})\n`);
			for (const instinct of domainInstincts.sort((a, b) => b.confidence - a.confidence)) {
				const bar =
					"█".repeat(Math.round(instinct.confidence * 10)) + "░".repeat(10 - Math.round(instinct.confidence * 10));
				const scope = instinct.scope === "global" ? "[G]" : "[P]";
				lines.push(`${bar} ${Math.round(instinct.confidence * 100)}% ${instinct.id} ${scope}`);
				lines.push(`    trigger: ${instinct.trigger.slice(0, 60)}${instinct.trigger.length > 60 ? "..." : ""}`);
				lines.push("");
			}
		}
	}

	if (pending.length > 0) {
		lines.push("## Pending Review\n");
		const now = new Date();
		for (const instinct of pending.slice(0, 10)) {
			const expiresIn = instinct.expiresAt
				? Math.ceil((new Date(instinct.expiresAt).getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
				: "N/A";
			lines.push(
				`- **${instinct.id}** (${Math.round(instinct.confidence * 100)}% confidence, expires in ${expiresIn}d)`,
			);
			lines.push(`  ${instinct.trigger.slice(0, 80)}`);
		}
		if (pending.length > 10) {
			lines.push(`\n*...and ${pending.length - 10} more*`);
		}
	}

	return lines.join("\n");
}

// ============================================================================
// Command: /instinct-analyze
// ============================================================================

export async function instinctAnalyzeCommand(_args: string[], ctx: HookCommandContext): Promise<string | undefined> {
	const observerState = getObserverState();
	let storage = getStorage();

	if (!storage) {
		storage = new ContinuousLearningStorage();
		await storage.initialize();
	}

	const config = storage.getConfig();
	const projectId = observerState.projectId ?? "global";

	ctx.ui.notify("Analyzing observations...", "info");

	const result = await analyzeObservations(storage, projectId, config);

	const lines: string[] = [];
	lines.push("# Pattern Analysis Results\n");
	lines.push(`**Timestamp:** ${result.timestamp}`);
	lines.push(`**Observations Analyzed:** ${result.observationsAnalyzed}`);
	lines.push(`**Duration:** ${result.durationMs}ms`);
	lines.push("");

	if (result.patterns.length > 0) {
		lines.push("## Patterns Detected\n");
		for (const pattern of result.patterns) {
			lines.push(`### ${pattern.suggestedId}`);
			lines.push(`- **Type:** ${pattern.type}`);
			lines.push(`- **Domain:** ${pattern.domain}`);
			lines.push(`- **Confidence:** ${Math.round(pattern.confidence * 100)}%`);
			lines.push(`- **Trigger:** ${pattern.trigger}`);
			lines.push(`- **Action:** ${pattern.action.slice(0, 200)}`);
			lines.push("");
		}
	} else {
		lines.push("*No new patterns detected.*");
	}

	if (result.instinctsCreated.length > 0) {
		lines.push("\n## Instincts Created");
		for (const id of result.instinctsCreated) {
			lines.push(`- ${id}`);
		}
	}

	if (result.instinctsUpdated.length > 0) {
		lines.push("\n## Instincts Updated");
		for (const id of result.instinctsUpdated) {
			lines.push(`- ${id}`);
		}
	}

	return lines.join("\n");
}

// ============================================================================
// Command: /instinct-health
// ============================================================================

export async function instinctHealthCommand(_args: string[], ctx: HookCommandContext): Promise<string | undefined> {
	let storage = getStorage();

	if (!storage) {
		storage = new ContinuousLearningStorage();
		await storage.initialize();
	}

	ctx.ui.notify("Running health check...", "info");

	const result = await storage.healthCheck();

	const lines: string[] = [];
	const statusEmoji = result.status === "healthy" ? "OK" : result.status === "degraded" ? "WARN" : "FAIL";
	lines.push(`# Health Check: ${statusEmoji}\n`);
	lines.push(`**Timestamp:** ${result.timestamp}`);
	lines.push(`**Schema Version:** ${result.schemaVersion}`);
	lines.push("");

	lines.push("## Checks\n");
	for (const check of result.checks) {
		const status = check.status === "pass" ? "[PASS]" : check.status === "warn" ? "[WARN]" : "[FAIL]";
		lines.push(`${status} ${check.name}`);
		if (check.message) {
			lines.push(`    ${check.message}`);
		}
	}

	if (result.storage) {
		lines.push("\n## Storage Statistics");
		lines.push(`- **Observations:** ${result.storage.observationsCount}`);
		lines.push(`- **Observations File Size:** ${result.storage.observationsFileSizeMb.toFixed(2)} MB`);
		lines.push(`- **Instincts:** ${result.storage.instinctsCount}`);
		lines.push(`- **Projects:** ${result.storage.projectsCount}`);
		lines.push(`- **Audit Log Entries:** ${result.storage.auditLogEntriesCount}`);
	}

	return lines.join("\n");
}

// ============================================================================
// Command: /instinct-prune
// ============================================================================

export async function instinctPruneCommand(_args: string[], ctx: HookCommandContext): Promise<string | undefined> {
	const observerState = getObserverState();
	let storage = getStorage();

	if (!storage) {
		storage = new ContinuousLearningStorage();
		await storage.initialize();
	}

	const projectId = observerState.projectId ?? "global";

	ctx.ui.notify("Pruning expired instincts...", "info");

	const pruned = await pruneExpiredInstincts(storage, projectId);

	if (pruned.length === 0) {
		return "No expired instincts to prune.";
	}

	const lines: string[] = [];
	lines.push(`# Pruned ${pruned.length} Expired Instincts\n`);
	for (const id of pruned) {
		lines.push(`- ${id}`);
	}

	return lines.join("\n");
}

// ============================================================================
// Command: /instinct-promote
// ============================================================================

export async function instinctPromoteCommand(_args: string[], ctx: HookCommandContext): Promise<string | undefined> {
	let storage = getStorage();

	if (!storage) {
		storage = new ContinuousLearningStorage();
		await storage.initialize();
	}

	const config = storage.getConfig();

	ctx.ui.notify("Checking for promotion candidates...", "info");

	const promoted = await promoteInstincts(storage, config);

	if (promoted.length === 0) {
		return `No instincts qualify for promotion.\n\nCriteria:\n- Appears in ${config.promoteMinProjects}+ projects\n- Average confidence >= ${config.promoteMinConfidence * 100}%`;
	}

	const lines: string[] = [];
	lines.push(`# Promoted ${promoted.length} Instincts to Global Scope\n`);
	for (const id of promoted) {
		lines.push(`- ${id}`);
	}

	return lines.join("\n");
}

// ============================================================================
// Command Registration
// ============================================================================

export const commands = [
	{
		name: "instinct-status",
		description: "Show continuous learning status and instincts",
		execute: instinctStatusCommand,
	},
	{
		name: "instinct-analyze",
		description: "Analyze observations and detect patterns",
		execute: instinctAnalyzeCommand,
	},
	{
		name: "instinct-health",
		description: "Run health check on continuous learning storage",
		execute: instinctHealthCommand,
	},
	{
		name: "instinct-prune",
		description: "Remove expired pending instincts",
		execute: instinctPruneCommand,
	},
	{
		name: "instinct-promote",
		description: "Promote project instincts to global scope",
		execute: instinctPromoteCommand,
	},
];

export default commands;
