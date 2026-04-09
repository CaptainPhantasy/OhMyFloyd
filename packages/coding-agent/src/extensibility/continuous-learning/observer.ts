/**
 * Continuous Learning v3 - Observer Hook
 *
 * TypeScript hook that subscribes to OMP tool events and records observations
 * for pattern analysis. Implements enterprise-grade features:
 * - Async non-blocking observation
 * - Secret redaction
 * - Project context detection
 * - Throttled analysis triggers
 */

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { logger } from "@oh-my-pi/pi-utils";
import type { HookContext, ToolCallEvent } from "../hooks/types";
import { analyzeObservations } from "./pattern-detector";
import { ContinuousLearningStorage, isoTimestamp, redactSecrets, uuid } from "./storage";
import type { Observation, ObservationEvent } from "./types";

// ============================================================================
// Project Detection
// ============================================================================

interface DetectedProject {
	id: string;
	name: string;
	root: string;
	remote?: string;
	source: "env" | "git" | "path" | "global";
}

/**
 * Detect current project context.
 * Priority: CLAUDE_PROJECT_DIR env > git remote > git root > global
 */
function detectProject(cwd?: string): DetectedProject {
	const workingDir = cwd || process.cwd();

	// 1. Check environment variable
	const envDir = process.env.CLAUDE_PROJECT_DIR || process.env.OMP_PROJECT_DIR;
	if (envDir && existsSync(envDir)) {
		return createProjectContext(envDir, "env");
	}

	// 2. Try git detection
	try {
		const gitRoot = execSync("git rev-parse --show-toplevel", {
			cwd: workingDir,
			encoding: "utf8",
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();

		if (gitRoot) {
			let remote: string | undefined;
			try {
				remote = execSync("git remote get-url origin", {
					cwd: gitRoot,
					encoding: "utf8",
					timeout: 5000,
					stdio: ["pipe", "pipe", "pipe"],
				}).trim();

				// Strip credentials from URL
				if (remote) {
					remote = remote.replace(/:\/\/[^@]+@/, "://");
				}
			} catch {
				// No remote configured
			}

			return createProjectContext(gitRoot, "git", remote);
		}
	} catch {
		// Not a git repository
	}

	// 3. Fallback to global
	return {
		id: "global",
		name: "global",
		root: "",
		source: "global",
	};
}

/**
 * Create project context with computed ID.
 */
function createProjectContext(root: string, source: "env" | "git" | "path", remote?: string): DetectedProject {
	const name = root.split("/").pop() || "unknown";
	const hashInput = remote || root;
	const id = createHash("sha256").update(hashInput).digest("hex").slice(0, 12);

	return {
		id,
		name,
		root: root.replace(/\/$/, ""), // Normalize trailing slash
		remote,
		source,
	};
}

// ============================================================================
// Observer State
// ============================================================================

interface ObserverState {
	storage: ContinuousLearningStorage | null;
	observationCount: number;
	lastAnalysisTrigger: number;
	project: DetectedProject | null;
	sessionId: string;
	enabled: boolean;
	initialized: boolean;
	/** Cached active instincts loaded at session start, refreshed after analysis */
	activeInstincts: import("./types").Instinct[];
	/** Whether an analysis is currently in progress (prevents overlapping runs) */
	analysisInFlight: boolean;
}

const state: ObserverState = {
	storage: null,
	observationCount: 0,
	lastAnalysisTrigger: 0,
	project: null,
	sessionId: uuid(),
	enabled: true,
	initialized: false,
	activeInstincts: [],
	analysisInFlight: false,
};

// Throttle: trigger analysis every N observations
const ANALYSIS_TRIGGER_INTERVAL = 20;

/**
 * Run pattern analysis in background after enough observations accumulate.
 * Non-blocking: errors are logged, never thrown to the caller.
 */
function triggerBackgroundAnalysis(): void {
	if (state.analysisInFlight || !state.storage || !state.project) return;
	state.analysisInFlight = true;

	const storage = state.storage;
	const projectId = state.project.id;

	(async () => {
		try {
			const config = storage.getConfig();
			const result = await analyzeObservations(storage, projectId, config);
			if (result.instinctsCreated.length > 0 || result.instinctsUpdated.length > 0) {
				// Refresh the active instincts cache so enforcement sees new patterns immediately
				await reloadActiveInstincts();
				logger.debug("ContinuousLearning: analysis complete", {
					created: result.instinctsCreated.length,
					updated: result.instinctsUpdated.length,
				});
			}
		} catch (err) {
			logger.error("ContinuousLearning: background analysis failed", { error: err });
		} finally {
			state.analysisInFlight = false;
		}
	})();
}

/**
 * Reload active instincts from storage into the in-memory cache.
 * Called at session start and after each analysis run.
 */
export async function reloadActiveInstincts(): Promise<void> {
	if (!state.storage || !state.project) {
		state.activeInstincts = [];
		return;
	}
	try {
		const projectInstincts = await state.storage.readAllInstincts(state.project.id);
		const globalInstincts = await state.storage.readAllInstincts("global");
		state.activeInstincts = [...projectInstincts, ...globalInstincts].filter(i => i.status === "active");
	} catch (err) {
		logger.error("ContinuousLearning: failed to reload instincts", { error: err });
		state.activeInstincts = [];
	}
}

/**
 * Get the current cached active instincts for enforcement injection.
 */
export function getActiveInstincts(): import("./types").Instinct[] {
	return state.activeInstincts;
}

// ============================================================================
// Automated Session Guards
// ============================================================================

/**
 * Check if this is an automated session that should not be observed.
 */
function isAutomatedSession(): boolean {
	// Layer 1: Entrypoint check
	const entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT || process.env.OMP_ENTRYPOINT || "cli";
	if (!["cli", "sdk-ts"].includes(entrypoint)) {
		return true;
	}

	// Layer 2: Minimal hook profile
	const hookProfile = process.env.ECC_HOOK_PROFILE || process.env.OMP_HOOK_PROFILE || "standard";
	if (hookProfile === "minimal") {
		return true;
	}

	// Layer 3: Explicit skip flag
	if (process.env.ECC_SKIP_OBSERVE === "1" || process.env.OMP_SKIP_OBSERVE === "1") {
		return true;
	}

	// Layer 4: Known observer session paths
	const skipPaths = (
		process.env.ECC_OBSERVE_SKIP_PATHS ||
		process.env.OMP_OBSERVE_SKIP_PATHS ||
		"observer-sessions,.claude-mem"
	).split(",");
	const cwd = process.cwd();
	for (const pattern of skipPaths) {
		const trimmed = pattern.trim();
		if (trimmed && cwd.includes(trimmed)) {
			return true;
		}
	}

	return false;
}

// ============================================================================
// Observer Initialization
// ============================================================================

/**
 * Initialize the observer. Called lazily on first event.
 */
async function initializeObserver(cwd?: string): Promise<boolean> {
	if (state.initialized) {
		return state.enabled;
	}

	state.initialized = true;

	// Check if automated session
	if (isAutomatedSession()) {
		state.enabled = false;
		return false;
	}

	// Initialize storage
	try {
		state.storage = new ContinuousLearningStorage();
		await state.storage.initialize();

		// Load config
		const config = state.storage.getConfig();
		state.enabled = config.enabled;

		if (!state.enabled) {
			return false;
		}

		// Detect project
		state.project = detectProject(cwd);

		// Register project in registry
		if (state.project.id !== "global") {
			const now = isoTimestamp();
			await state.storage.updateProjectRegistry({
				id: state.project.id,
				name: state.project.name,
				root: state.project.root,
				remote: state.project.remote,
				source: state.project.source,
				createdAt: now,
				lastSeen: now,
			});
		}

		return true;
	} catch (error) {
		logger.error("ContinuousLearning initialization failed", { error });
		state.enabled = false;
		return false;
	}
}

// ============================================================================
// Event Handlers
// ============================================================================

/**
 * Handle tool_call event (before tool execution).
 */
export async function handleToolCall(event: ToolCallEvent, ctx: HookContext): Promise<void> {
	if (!(await initializeObserver(ctx.cwd))) {
		return;
	}

	if (!state.storage || !state.project) {
		return;
	}

	try {
		const config = state.storage.getConfig();

		// Prepare observation
		const inputStr = JSON.stringify(event.input).slice(0, 5000);

		const observation: Omit<Observation, "id" | "checksum" | "schemaVersion"> = {
			timestamp: isoTimestamp(),
			event: "tool_start",
			tool: event.toolName,
			input: redactSecrets(inputStr, config.secretPatterns),
			sessionId: state.sessionId,
			toolUseId: event.toolCallId,
			projectId: state.project.id,
			projectName: state.project.name,
			cwd: ctx.cwd,
		};

		// Write asynchronously (fire and forget)
		state.storage.writeObservation(observation).catch(err => {
			logger.error("ContinuousLearning: failed to write observation", { error: err });
		});

		state.observationCount++;
	} catch (error) {
		logger.error("ContinuousLearning: error handling tool_call", { error });
	}
}

/**
 * Handle tool_result event (after tool execution).
 */
export async function handleToolResult(
	event: { tool: string; toolUseId?: string; output?: unknown; error?: string },
	ctx: HookContext,
): Promise<void> {
	if (!(await initializeObserver(ctx.cwd))) {
		return;
	}

	if (!state.storage || !state.project) {
		return;
	}

	try {
		const config = state.storage.getConfig();

		// Determine event type
		const eventType: ObservationEvent = event.error ? "tool_error" : "tool_complete";

		// Prepare output
		let outputStr: string | undefined;
		if (event.output !== undefined) {
			outputStr =
				typeof event.output === "string"
					? event.output.slice(0, 5000)
					: JSON.stringify(event.output).slice(0, 5000);
			outputStr = redactSecrets(outputStr, config.secretPatterns);
		}

		const observation: Omit<Observation, "id" | "checksum" | "schemaVersion"> = {
			timestamp: isoTimestamp(),
			event: eventType,
			tool: event.tool,
			output: outputStr,
			error: event.error,
			sessionId: state.sessionId,
			toolUseId: event.toolUseId,
			projectId: state.project.id,
			projectName: state.project.name,
			cwd: ctx.cwd,
		};

		// Write asynchronously
		state.storage.writeObservation(observation).catch(err => {
			logger.error("ContinuousLearning: failed to write observation", { error: err });
		});

		state.observationCount++;

		// Trigger analysis after enough observations accumulate
		if (state.observationCount - state.lastAnalysisTrigger >= ANALYSIS_TRIGGER_INTERVAL) {
			state.lastAnalysisTrigger = state.observationCount;
			triggerBackgroundAnalysis();
		}
	} catch (error) {
		logger.error("ContinuousLearning: error handling tool_result", { error });
	}
}

/**
 * Handle session start event.
 */
export async function handleSessionStart(ctx: HookContext): Promise<void> {
	// Reset session ID
	state.sessionId = uuid();
	state.observationCount = 0;
	state.lastAnalysisTrigger = 0;

	if (!(await initializeObserver(ctx.cwd))) {
		return;
	}

	if (!state.storage || !state.project) {
		return;
	}

	try {
		const observation: Omit<Observation, "id" | "checksum" | "schemaVersion"> = {
			timestamp: isoTimestamp(),
			event: "session_start",
			sessionId: state.sessionId,
			projectId: state.project.id,
			projectName: state.project.name,
			cwd: ctx.cwd,
		};

		await state.storage.writeObservation(observation);

		// Purge old archives on session start
		await state.storage.purgeOldArchives(state.project.id);
	} catch (error) {
		logger.error("ContinuousLearning: error handling session_start", { error });
	}
}

/**
 * Handle session end/shutdown event.
 */
export async function handleSessionEnd(ctx: HookContext): Promise<void> {
	if (!state.enabled || !state.storage || !state.project) {
		return;
	}

	try {
		const observation: Omit<Observation, "id" | "checksum" | "schemaVersion"> = {
			timestamp: isoTimestamp(),
			event: "session_end",
			sessionId: state.sessionId,
			projectId: state.project.id,
			projectName: state.project.name,
			cwd: ctx.cwd,
		};

		await state.storage.writeObservation(observation);
	} catch (error) {
		logger.error("ContinuousLearning: error handling session_end", { error });
	}
}

// ============================================================================
// API for External Use
// ============================================================================

/**
 * Get the current observer state (for debugging/status).
 */
export function getObserverState(): {
	enabled: boolean;
	initialized: boolean;
	projectId: string | null;
	projectName: string | null;
	sessionId: string;
	observationCount: number;
} {
	return {
		enabled: state.enabled,
		initialized: state.initialized,
		projectId: state.project?.id ?? null,
		projectName: state.project?.name ?? null,
		sessionId: state.sessionId,
		observationCount: state.observationCount,
	};
}

/**
 * Get the storage instance (for commands/CLI).
 */
export function getStorage(): ContinuousLearningStorage | null {
	return state.storage;
}

/**
 * Force re-detection of project context.
 */
export async function refreshProjectContext(cwd?: string): Promise<void> {
	state.project = detectProject(cwd);

	if (state.storage && state.project.id !== "global") {
		const now = isoTimestamp();
		await state.storage.updateProjectRegistry({
			id: state.project.id,
			name: state.project.name,
			root: state.project.root,
			remote: state.project.remote,
			source: state.project.source,
			createdAt: now,
			lastSeen: now,
		});
	}
}

/**
 * Disable observation for this session.
 */
export function disableObserver(): void {
	state.enabled = false;
}

/**
 * Enable observation for this session.
 */
export function enableObserver(): void {
	state.enabled = true;
}
