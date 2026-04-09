/**
 * Continuous Learning v3 - Pattern Detection Engine
 *
 * Analyzes observations to detect reusable patterns and create instincts.
 * Pattern types:
 * - Error resolution: Same error followed by successful resolution
 * - User correction: Model output corrected by user
 * - Repeated workflow: Same sequence of tools used multiple times
 * - Workaround: Non-obvious solution to a common problem
 */
import { type ContinuousLearningStorage, isoTimestamp, uuid } from "./storage";
import type {
	AnalysisResult,
	ContinuousLearningConfig,
	Instinct,
	InstinctDomain,
	Observation,
	PatternCandidate,
} from "./types";

// ============================================================================
// Pattern Detection Utilities
// ============================================================================

/**
 * Group observations by session.
 */
function groupBySession(observations: Observation[]): Map<string, Observation[]> {
	const groups = new Map<string, Observation[]>();
	for (const obs of observations) {
		const existing = groups.get(obs.sessionId) ?? [];
		existing.push(obs);
		groups.set(obs.sessionId, existing);
	}
	return groups;
}

/**
 * Group observations by tool.
 */
function _groupByTool(observations: Observation[]): Map<string, Observation[]> {
	const groups = new Map<string, Observation[]>();
	for (const obs of observations) {
		if (!obs.tool) continue;
		const existing = groups.get(obs.tool) ?? [];
		existing.push(obs);
		groups.set(obs.tool, existing);
	}
	return groups;
}

/**
 * Extract error patterns from observations.
 */
function extractErrorPatterns(observations: Observation[]): {
	error: string;
	resolution: string;
	tool: string;
	count: number;
	evidence: string[];
}[] {
	const patterns: Map<
		string,
		{
			error: string;
			resolution: string;
			tool: string;
			count: number;
			evidence: string[];
		}
	> = new Map();

	// Sort by timestamp
	const sorted = [...observations].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

	// Look for error -> success sequences
	for (let i = 0; i < sorted.length - 1; i++) {
		const current = sorted[i];
		const next = sorted[i + 1];

		if (
			current.event === "tool_error" &&
			current.error &&
			next.event === "tool_complete" &&
			current.tool === next.tool
		) {
			// Normalize error message
			const errorKey = normalizeError(current.error);
			const key = `${current.tool}:${errorKey}`;

			const existing = patterns.get(key);
			if (existing) {
				existing.count++;
				existing.evidence.push(current.id, next.id);
			} else {
				patterns.set(key, {
					error: current.error.slice(0, 200),
					resolution: extractResolutionHint(current, next),
					tool: current.tool ?? "unknown",
					count: 1,
					evidence: [current.id, next.id],
				});
			}
		}
	}

	return Array.from(patterns.values()).filter(p => p.count >= 2);
}

/**
 * Normalize error message for pattern matching.
 */
function normalizeError(error: string): string {
	return error
		.replace(/\d+/g, "N") // Replace numbers
		.replace(/\/[^\s]+/g, "/PATH") // Replace paths
		.replace(/"[^"]+"/g, '"VALUE"') // Replace quoted strings
		.slice(0, 100)
		.toLowerCase()
		.trim();
}

/**
 * Extract resolution hint from successful tool use.
 */
function extractResolutionHint(error: Observation, success: Observation): string {
	const errorInput = error.input ?? "";
	const successInput = success.input ?? "";

	if (errorInput !== successInput && successInput.length < 500) {
		return `Changed input from approximate: "${errorInput.slice(0, 100)}..." to: "${successInput.slice(0, 100)}..."`;
	}

	return `Retry with ${success.tool} succeeded after error`;
}

/**
 * Detect repeated tool workflows.
 */
function detectRepeatedWorkflows(sessionGroups: Map<string, Observation[]>): {
	sequence: string[];
	count: number;
	evidence: string[];
}[] {
	const sequences: Map<string, { sequence: string[]; count: number; evidence: string[] }> = new Map();

	for (const [_sessionId, observations] of sessionGroups) {
		// Extract tool sequence
		const toolSequence = observations
			.filter(o => o.tool && (o.event === "tool_start" || o.event === "tool_complete"))
			.map(o => o.tool!);

		// Look for repeated subsequences of length 3-5
		for (let len = 3; len <= 5; len++) {
			for (let i = 0; i <= toolSequence.length - len; i++) {
				const subseq = toolSequence.slice(i, i + len);
				const key = subseq.join("->");

				// Count occurrences in full sequence
				let count = 0;
				for (let j = 0; j <= toolSequence.length - len; j++) {
					const check = toolSequence.slice(j, j + len).join("->");
					if (check === key) count++;
				}

				if (count >= 2) {
					const existing = sequences.get(key);
					if (existing) {
						existing.count++;
						existing.evidence.push(...observations.slice(i, i + len).map(o => o.id));
					} else {
						sequences.set(key, {
							sequence: subseq,
							count,
							evidence: observations.slice(i, i + len).map(o => o.id),
						});
					}
				}
			}
		}
	}

	return Array.from(sequences.values()).filter(s => s.count >= 3);
}

/**
 * Infer domain from tool name.
 */
function inferDomain(tool: string): InstinctDomain {
	const toolLower = tool.toLowerCase();

	if (["grep", "find", "read", "lsp"].some(t => toolLower.includes(t))) {
		return "debugging";
	}
	if (["edit", "write", "ast_edit", "ast_grep"].some(t => toolLower.includes(t))) {
		return "code-style";
	}
	if (["bash", "shell", "git"].some(t => toolLower.includes(t))) {
		return toolLower.includes("git") ? "git" : "workflow";
	}
	if (["test", "spec", "jest", "vitest"].some(t => toolLower.includes(t))) {
		return "testing";
	}

	return "general";
}

/**
 * Generate instinct ID from pattern.
 */
function generateInstinctId(pattern: PatternCandidate): string {
	const base = pattern.trigger
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 50);

	return base || `pattern-${uuid().slice(0, 8)}`;
}

// ============================================================================
// Main Analysis Function
// ============================================================================

/**
 * Analyze observations and generate pattern candidates.
 */
export async function analyzeObservations(
	storage: ContinuousLearningStorage,
	projectId: string,
	config: ContinuousLearningConfig,
): Promise<AnalysisResult> {
	const startTime = Date.now();
	const observations = await storage.readObservations(projectId);
	const existingInstincts = await storage.readAllInstincts(projectId);
	const _existingIds = new Set(existingInstincts.map(i => i.id));

	const patterns: PatternCandidate[] = [];
	const instinctsCreated: string[] = [];
	const instinctsUpdated: string[] = [];

	// Skip if not enough observations
	if (observations.length < config.minObservationsForAnalysis) {
		return {
			timestamp: isoTimestamp(),
			observationsAnalyzed: observations.length,
			patterns: [],
			instinctsCreated: [],
			instinctsUpdated: [],
			durationMs: Date.now() - startTime,
		};
	}

	const sessionGroups = groupBySession(observations);

	// 1. Detect error resolution patterns
	const errorPatterns = extractErrorPatterns(observations);
	for (const ep of errorPatterns) {
		if (!config.detectDomains.includes(inferDomain(ep.tool))) continue;

		const confidence = Math.min(0.3 + ep.count * 0.1, 0.9);
		const candidate: PatternCandidate = {
			type: "error_resolution",
			confidence,
			domain: inferDomain(ep.tool),
			trigger: `When ${ep.tool} fails with error: ${ep.error}`,
			action: ep.resolution,
			evidence: ep.evidence.slice(0, 10),
			suggestedId: `resolve-${ep.tool}-${normalizeError(ep.error).slice(0, 20).replace(/\s+/g, "-")}`,
		};
		patterns.push(candidate);
	}

	// 2. Detect repeated workflows
	const workflows = detectRepeatedWorkflows(sessionGroups);
	for (const wf of workflows) {
		if (wf.sequence.length < 3) continue;

		const confidence = Math.min(0.3 + wf.count * 0.05, 0.8);
		const candidate: PatternCandidate = {
			type: "repeated_workflow",
			confidence,
			domain: "workflow",
			trigger: `When performing a task that requires ${wf.sequence[0]}`,
			action: `Use the sequence: ${wf.sequence.join(" -> ")}`,
			evidence: wf.evidence.slice(0, 10),
			suggestedId: `workflow-${wf.sequence.slice(0, 3).join("-")}`.toLowerCase(),
		};
		patterns.push(candidate);
	}

	// 3. Create or update instincts from high-confidence patterns
	for (const pattern of patterns) {
		const id = generateInstinctId(pattern);

		// Skip if already exists with higher confidence
		const existing = existingInstincts.find(i => i.id === id);
		if (existing) {
			if (pattern.confidence > existing.confidence) {
				// Update existing
				await storage.updateInstinct(id, {
					confidence: pattern.confidence,
					observationCount: existing.observationCount + 1,
					evidence: [...new Set([...existing.evidence, ...pattern.evidence])].slice(0, 20),
				});
				instinctsUpdated.push(id);
			}
			continue;
		}

		// Create new instinct
		const now = isoTimestamp();
		const ttlDays = config.pendingTtlDays;
		const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

		const instinct: Omit<Instinct, "checksum"> = {
			id,
			schemaVersion: "3.0.0",
			trigger: pattern.trigger,
			confidence: pattern.confidence,
			domain: pattern.domain,
			source: "observation",
			scope: "project",
			status: pattern.confidence >= config.autoApproveThreshold ? "active" : "pending",
			projectId,
			createdAt: now,
			updatedAt: now,
			observationCount: 1,
			evidence: pattern.evidence,
			action: pattern.action,
			expiresAt: pattern.confidence < config.autoApproveThreshold ? expiresAt : undefined,
		};

		await storage.writeInstinct(instinct);
		instinctsCreated.push(id);
	}

	return {
		timestamp: isoTimestamp(),
		observationsAnalyzed: observations.length,
		patterns,
		instinctsCreated,
		instinctsUpdated,
		durationMs: Date.now() - startTime,
	};
}

/**
 * Prune expired pending instincts.
 */
export async function pruneExpiredInstincts(storage: ContinuousLearningStorage, projectId?: string): Promise<string[]> {
	const instincts = await storage.readAllInstincts(projectId);
	const now = new Date();
	const pruned: string[] = [];

	for (const instinct of instincts) {
		if (instinct.status === "pending" && instinct.expiresAt && new Date(instinct.expiresAt) < now) {
			await storage.deleteInstinct(instinct.id, instinct.projectId);
			pruned.push(instinct.id);
		}
	}

	return pruned;
}

/**
 * Promote project instincts to global scope if criteria met.
 */
export async function promoteInstincts(
	storage: ContinuousLearningStorage,
	config: ContinuousLearningConfig,
): Promise<string[]> {
	const projects = await storage.readProjectRegistry();
	const projectIds = Object.keys(projects);

	if (projectIds.length < config.promoteMinProjects) {
		return [];
	}

	// Collect all instincts by ID
	const instinctsByProject: Map<string, Instinct[]> = new Map();
	for (const projectId of projectIds) {
		const instincts = await storage.readAllInstincts(projectId);
		instinctsByProject.set(
			projectId,
			instincts.filter(i => i.scope === "project"),
		);
	}

	// Find instincts that appear in multiple projects
	const idCounts: Map<string, { count: number; avgConfidence: number; instincts: Instinct[] }> = new Map();

	for (const [_projectId, instincts] of instinctsByProject) {
		for (const instinct of instincts) {
			const existing = idCounts.get(instinct.id);
			if (existing) {
				existing.count++;
				existing.avgConfidence =
					(existing.avgConfidence * (existing.count - 1) + instinct.confidence) / existing.count;
				existing.instincts.push(instinct);
			} else {
				idCounts.set(instinct.id, {
					count: 1,
					avgConfidence: instinct.confidence,
					instincts: [instinct],
				});
			}
		}
	}

	// Promote qualifying instincts
	const promoted: string[] = [];
	for (const [id, data] of idCounts) {
		if (data.count >= config.promoteMinProjects && data.avgConfidence >= config.promoteMinConfidence) {
			// Create global version with highest confidence
			const best = data.instincts.reduce((a, b) => (a.confidence > b.confidence ? a : b));

			const now = isoTimestamp();
			const globalInstinct: Omit<Instinct, "checksum"> = {
				...best,
				scope: "global",
				projectId: undefined,
				projectName: undefined,
				updatedAt: now,
				observationCount: data.instincts.reduce((sum, i) => sum + i.observationCount, 0),
				evidence: [...new Set(data.instincts.flatMap(i => i.evidence))].slice(0, 50),
			};

			await storage.writeInstinct(globalInstinct);
			promoted.push(id);
		}
	}

	return promoted;
}
