/**
 * Continuous Learning v3 - Enterprise Grade
 *
 * Type definitions and Zod schemas for the continuous learning system.
 * All data structures are validated at runtime to ensure integrity.
 */
import { z } from "zod";

// ============================================================================
// Schema Version - Increment on breaking changes for migration support
// ============================================================================

export const SCHEMA_VERSION = "3.0.0";

// ============================================================================
// Project Context
// ============================================================================

export const ProjectContextSchema = z.object({
	/** Unique project identifier (SHA256 hash of remote URL or path, first 12 chars) */
	id: z.string().min(1).max(64),
	/** Human-readable project name (directory basename) */
	name: z.string().min(1).max(256),
	/** Absolute path to project root */
	root: z.string(),
	/** Git remote URL (if available) */
	remote: z.string().optional(),
	/** Project detection source */
	source: z.enum(["env", "git", "path", "global"]),
	/** First seen timestamp (ISO 8601) */
	createdAt: z.string().datetime(),
	/** Last activity timestamp (ISO 8601) */
	lastSeen: z.string().datetime(),
});

export type ProjectContext = z.infer<typeof ProjectContextSchema>;

// ============================================================================
// Observation - Raw event data from tool calls
// ============================================================================

export const ObservationEventSchema = z.enum([
	"tool_start",
	"tool_complete",
	"tool_error",
	"user_correction",
	"session_start",
	"session_end",
]);

export type ObservationEvent = z.infer<typeof ObservationEventSchema>;

export const ObservationSchema = z.object({
	/** Observation ID (UUID v4) */
	id: z.string().uuid(),
	/** Schema version for migration support */
	schemaVersion: z.string().default(SCHEMA_VERSION),
	/** ISO 8601 timestamp */
	timestamp: z.string().datetime(),
	/** Event type */
	event: ObservationEventSchema,
	/** Tool name (if applicable) */
	tool: z.string().optional(),
	/** Tool input (truncated, secrets redacted) */
	input: z.string().max(10000).optional(),
	/** Tool output (truncated, secrets redacted) */
	output: z.string().max(10000).optional(),
	/** Error message (if applicable) */
	error: z.string().optional(),
	/** Session ID */
	sessionId: z.string(),
	/** Tool use ID (for correlation) */
	toolUseId: z.string().optional(),
	/** Project context */
	projectId: z.string(),
	projectName: z.string(),
	/** Working directory at time of observation */
	cwd: z.string().optional(),
	/** SHA256 checksum of the observation content (excluding this field) */
	checksum: z.string().optional(),
});

export type Observation = z.infer<typeof ObservationSchema>;

// ============================================================================
// Instinct - Atomic learned behavior
// ============================================================================

export const InstinctScopeSchema = z.enum(["project", "global"]);
export type InstinctScope = z.infer<typeof InstinctScopeSchema>;

export const InstinctDomainSchema = z.enum([
	"code-style",
	"testing",
	"git",
	"debugging",
	"workflow",
	"error-handling",
	"security",
	"performance",
	"documentation",
	"general",
]);
export type InstinctDomain = z.infer<typeof InstinctDomainSchema>;

export const InstinctSourceSchema = z.enum(["observation", "correction", "imported", "evolved", "manual"]);
export type InstinctSource = z.infer<typeof InstinctSourceSchema>;

export const InstinctStatusSchema = z.enum([
	"pending", // Awaiting review
	"active", // Approved and in use
	"archived", // Deprecated but preserved
	"rejected", // Rejected by user
]);
export type InstinctStatus = z.infer<typeof InstinctStatusSchema>;

export const InstinctSchema = z.object({
	/** Unique instinct identifier (kebab-case) */
	id: z
		.string()
		.regex(/^[a-z][a-z0-9-]*[a-z0-9]$/)
		.min(3)
		.max(64),
	/** Schema version */
	schemaVersion: z.string().default(SCHEMA_VERSION),
	/** Human-readable trigger description */
	trigger: z.string().min(1).max(500),
	/** Confidence score (0.0 - 1.0) */
	confidence: z.number().min(0).max(1),
	/** Domain classification */
	domain: InstinctDomainSchema,
	/** How this instinct was created */
	source: InstinctSourceSchema,
	/** Scope: project-specific or global */
	scope: InstinctScopeSchema,
	/** Current status */
	status: InstinctStatusSchema.default("pending"),
	/** Project ID (if project-scoped) */
	projectId: z.string().optional(),
	/** Project name (if project-scoped) */
	projectName: z.string().optional(),
	/** Creation timestamp (ISO 8601) */
	createdAt: z.string().datetime(),
	/** Last update timestamp (ISO 8601) */
	updatedAt: z.string().datetime(),
	/** Number of times this pattern was observed */
	observationCount: z.number().int().min(1).default(1),
	/** Evidence: observation IDs that contributed to this instinct */
	evidence: z.array(z.string().uuid()).default([]),
	/** Action description (what to do when triggered) */
	action: z.string().min(1).max(2000),
	/** Optional examples */
	examples: z.array(z.string()).optional(),
	/** Import source (if imported) */
	importedFrom: z.string().optional(),
	/** Checksum for integrity verification */
	checksum: z.string().optional(),
	/** TTL expiration date for pending instincts (ISO 8601) */
	expiresAt: z.string().datetime().optional(),
});

export type Instinct = z.infer<typeof InstinctSchema>;

// ============================================================================
// Audit Log Entry
// ============================================================================

export const AuditOperationSchema = z.enum([
	"observation_created",
	"instinct_created",
	"instinct_updated",
	"instinct_promoted",
	"instinct_archived",
	"instinct_rejected",
	"instinct_imported",
	"instinct_exported",
	"storage_compacted",
	"storage_purged",
	"config_changed",
	"health_check",
]);

export type AuditOperation = z.infer<typeof AuditOperationSchema>;

export const AuditLogEntrySchema = z.object({
	/** Entry ID (UUID v4) */
	id: z.string().uuid(),
	/** ISO 8601 timestamp */
	timestamp: z.string().datetime(),
	/** Operation type */
	operation: AuditOperationSchema,
	/** Target entity ID (observation/instinct ID) */
	targetId: z.string().optional(),
	/** Target entity type */
	targetType: z.enum(["observation", "instinct", "config", "storage"]).optional(),
	/** Project context */
	projectId: z.string().optional(),
	/** Operation details */
	details: z.record(z.string(), z.unknown()).optional(),
	/** Result status */
	status: z.enum(["success", "failure", "skipped"]),
	/** Error message (if failed) */
	error: z.string().optional(),
	/** Checksum of the entry */
	checksum: z.string().optional(),
});

export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

// ============================================================================
// Configuration
// ============================================================================

export const ContinuousLearningConfigSchema = z.object({
	/** Schema version */
	schemaVersion: z.string().default(SCHEMA_VERSION),
	/** Whether observation is enabled */
	enabled: z.boolean().default(true),
	/** Minimum observations before pattern analysis */
	minObservationsForAnalysis: z.number().int().min(1).default(20),
	/** Minimum confidence for auto-approval */
	autoApproveThreshold: z.number().min(0).max(1).default(0.9),
	/** TTL for pending instincts (days) */
	pendingTtlDays: z.number().int().min(1).default(30),
	/** Maximum observation file size before rotation (MB) */
	maxObservationFileSizeMb: z.number().min(1).default(10),
	/** Observation archive retention (days) */
	archiveRetentionDays: z.number().int().min(1).default(30),
	/** Domains to detect */
	detectDomains: z
		.array(InstinctDomainSchema)
		.default(["code-style", "testing", "debugging", "workflow", "error-handling"]),
	/** Patterns to ignore */
	ignorePatterns: z.array(z.string()).default(["simple_typos", "one_time_fixes", "external_api_issues"]),
	/** Secret patterns to redact (regex strings) */
	secretPatterns: z
		.array(z.string())
		.default([
			"(?i)(api[_-]?key|token|secret|password|authorization|credentials?|auth)[\"'\\s:=]+([A-Za-z]+\\s+)?[A-Za-z0-9_\\-/.+=]{8,}",
		]),
	/** Minimum projects for auto-promotion to global */
	promoteMinProjects: z.number().int().min(2).default(2),
	/** Minimum confidence for auto-promotion */
	promoteMinConfidence: z.number().min(0).max(1).default(0.8),
});

export type ContinuousLearningConfig = z.infer<typeof ContinuousLearningConfigSchema>;

// ============================================================================
// Health Check Result
// ============================================================================

export const HealthCheckResultSchema = z.object({
	/** Check timestamp (ISO 8601) */
	timestamp: z.string().datetime(),
	/** Overall health status */
	status: z.enum(["healthy", "degraded", "unhealthy"]),
	/** Individual check results */
	checks: z.array(
		z.object({
			name: z.string(),
			status: z.enum(["pass", "fail", "warn"]),
			message: z.string().optional(),
			durationMs: z.number().optional(),
		}),
	),
	/** Storage statistics */
	storage: z
		.object({
			observationsCount: z.number().int(),
			observationsFileSizeMb: z.number(),
			instinctsCount: z.number().int(),
			projectsCount: z.number().int(),
			auditLogEntriesCount: z.number().int(),
		})
		.optional(),
	/** Schema version in use */
	schemaVersion: z.string(),
});

export type HealthCheckResult = z.infer<typeof HealthCheckResultSchema>;

// ============================================================================
// Export Types for Pattern Detection
// ============================================================================

export interface PatternCandidate {
	/** Pattern type */
	type: "error_resolution" | "user_correction" | "repeated_workflow" | "workaround";
	/** Confidence score */
	confidence: number;
	/** Domain classification */
	domain: InstinctDomain;
	/** Trigger description */
	trigger: string;
	/** Action description */
	action: string;
	/** Supporting observation IDs */
	evidence: string[];
	/** Suggested instinct ID */
	suggestedId: string;
}

export interface AnalysisResult {
	/** Analysis timestamp */
	timestamp: string;
	/** Observations analyzed */
	observationsAnalyzed: number;
	/** Patterns detected */
	patterns: PatternCandidate[];
	/** Instincts created */
	instinctsCreated: string[];
	/** Instincts updated */
	instinctsUpdated: string[];
	/** Analysis duration (ms) */
	durationMs: number;
}
