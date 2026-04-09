/**
 * Continuous Learning v3 - Storage Layer
 *
 * Enterprise-grade storage with:
 * - Atomic writes using temp files + rename
 * - SHA256 checksums for integrity verification
 * - JSONL for observations (append-only, rotatable)
 * - YAML for instincts (human-readable)
 * - File locking for concurrent access safety
 */
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	type AuditLogEntry,
	AuditLogEntrySchema,
	type AuditOperation,
	type ContinuousLearningConfig,
	ContinuousLearningConfigSchema,
	type HealthCheckResult,
	type Instinct,
	InstinctSchema,
	type Observation,
	ObservationSchema,
	type ProjectContext,
	ProjectContextSchema,
	SCHEMA_VERSION,
} from "./types";

// ============================================================================
// Constants
// ============================================================================

const OMP_DIR = ".omp";
const HOMUNCULUS_DIR = "homunculus";
const PROJECTS_DIR = "projects";
const INSTINCTS_DIR = "instincts";
const PERSONAL_DIR = "personal";
const INHERITED_DIR = "inherited";
const EVOLVED_DIR = "evolved";
const OBSERVATIONS_FILE = "observations.jsonl";
const AUDIT_LOG_FILE = "audit.jsonl";
const CONFIG_FILE = "config.json";
const REGISTRY_FILE = "projects.json";
const _LOCK_SUFFIX = ".lock";
const TMP_SUFFIX = ".tmp";

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Compute SHA256 checksum of data.
 */
export function computeChecksum(data: string): string {
	return createHash("sha256").update(data, "utf8").digest("hex");
}

/**
 * Generate ISO 8601 timestamp.
 */
export function isoTimestamp(): string {
	return new Date().toISOString();
}

/**
 * Generate UUID v4.
 */
export function uuid(): string {
	return randomUUID();
}

/**
 * Atomic write: write to temp file, then rename.
 */
async function atomicWriteFile(path: string, content: string): Promise<void> {
	const dir = dirname(path);
	await mkdir(dir, { recursive: true });

	const tmpPath = `${path}${TMP_SUFFIX}.${process.pid}.${Date.now()}`;
	try {
		await writeFile(tmpPath, content, "utf8");
		await rename(tmpPath, path);
	} catch (error) {
		// Clean up temp file on failure
		try {
			await rm(tmpPath, { force: true });
		} catch {
			// Ignore cleanup errors
		}
		throw error;
	}
}

/**
 * Append line to JSONL file with newline.
 */
async function appendJsonl(path: string, data: unknown): Promise<void> {
	const dir = dirname(path);
	await mkdir(dir, { recursive: true });
	const line = `${JSON.stringify(data)}\n`;
	await appendFile(path, line, "utf8");
}

/**
 * Read JSONL file and parse each line.
 */
async function readJsonl<T>(path: string): Promise<T[]> {
	try {
		const content = await readFile(path, "utf8");
		const lines = content.trim().split("\n").filter(Boolean);
		return lines.map(line => JSON.parse(line) as T);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return [];
		}
		throw error;
	}
}

/**
 * Get file size in megabytes.
 */
async function getFileSizeMb(path: string): Promise<number> {
	try {
		const stats = await stat(path);
		return stats.size / (1024 * 1024);
	} catch {
		return 0;
	}
}

/**
 * Redact secrets from a string using configured patterns.
 */
export function redactSecrets(value: string, patterns: string[]): string {
	let result = value;
	for (const pattern of patterns) {
		try {
			const regex = new RegExp(pattern, "gi");
			result = result.replace(regex, (_match, key, sep) => {
				// Preserve key and separator, redact the value
				if (typeof key === "string" && typeof sep === "string") {
					return `${key}${sep}[REDACTED]`;
				}
				return "[REDACTED]";
			});
		} catch {
			// Invalid regex, skip
		}
	}
	return result;
}

/**
 * Convert instinct to YAML frontmatter format.
 */
function instinctToYaml(instinct: Instinct): string {
	const lines: string[] = ["---"];
	lines.push(`id: ${instinct.id}`);
	lines.push(`schemaVersion: "${instinct.schemaVersion}"`);
	lines.push(`trigger: "${escapeYamlString(instinct.trigger)}"`);
	lines.push(`confidence: ${instinct.confidence}`);
	lines.push(`domain: ${instinct.domain}`);
	lines.push(`source: ${instinct.source}`);
	lines.push(`scope: ${instinct.scope}`);
	lines.push(`status: ${instinct.status}`);
	if (instinct.projectId) lines.push(`projectId: ${instinct.projectId}`);
	if (instinct.projectName) lines.push(`projectName: "${escapeYamlString(instinct.projectName)}"`);
	lines.push(`createdAt: ${instinct.createdAt}`);
	lines.push(`updatedAt: ${instinct.updatedAt}`);
	lines.push(`observationCount: ${instinct.observationCount}`);
	if (instinct.evidence.length > 0) {
		lines.push("evidence:");
		for (const id of instinct.evidence) {
			lines.push(`  - ${id}`);
		}
	}
	if (instinct.importedFrom) lines.push(`importedFrom: "${escapeYamlString(instinct.importedFrom)}"`);
	if (instinct.expiresAt) lines.push(`expiresAt: ${instinct.expiresAt}`);
	if (instinct.checksum) lines.push(`checksum: ${instinct.checksum}`);
	lines.push("---");
	lines.push("");
	lines.push(`# ${instinct.id}`);
	lines.push("");
	lines.push("## Action");
	lines.push(instinct.action);
	if (instinct.examples && instinct.examples.length > 0) {
		lines.push("");
		lines.push("## Examples");
		for (const example of instinct.examples) {
			lines.push(`- ${example}`);
		}
	}
	lines.push("");
	return lines.join("\n");
}

/**
 * Escape string for YAML double-quoted value.
 */
function escapeYamlString(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Parse YAML frontmatter instinct file.
 */
function parseInstinctYaml(content: string): Instinct | null {
	const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (!frontmatterMatch) return null;

	const [, frontmatter, body] = frontmatterMatch;
	const data: Record<string, unknown> = {};

	// Parse frontmatter
	for (const line of frontmatter.split("\n")) {
		const colonIndex = line.indexOf(":");
		if (colonIndex === -1) continue;

		const key = line.slice(0, colonIndex).trim();
		let value: unknown = line.slice(colonIndex + 1).trim();

		// Handle quoted strings
		if (typeof value === "string") {
			if (value.startsWith('"') && value.endsWith('"')) {
				value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
			} else if (value === "true") {
				value = true;
			} else if (value === "false") {
				value = false;
			} else if (!Number.isNaN(Number(value))) {
				value = Number(value);
			}
		}

		data[key] = value;
	}

	// Parse evidence array if present
	const evidenceMatch = content.match(/evidence:\n((?: {2}- [^\n]+\n)+)/);
	if (evidenceMatch) {
		data.evidence = evidenceMatch[1]
			.split("\n")
			.filter(Boolean)
			.map(line => line.replace(/^\s*-\s*/, "").trim());
	} else {
		data.evidence = [];
	}

	// Extract action from body
	const actionMatch = body.match(/## Action\n([\s\S]*?)(?:\n## |\n*$)/);
	data.action = actionMatch ? actionMatch[1].trim() : "";

	// Extract examples
	const examplesMatch = body.match(/## Examples\n([\s\S]*?)(?:\n## |\n*$)/);
	if (examplesMatch) {
		data.examples = examplesMatch[1]
			.split("\n")
			.filter(line => line.startsWith("- "))
			.map(line => line.slice(2).trim());
	}

	// Validate with Zod
	const result = InstinctSchema.safeParse(data);
	if (!result.success) {
		return null;
	}
	return result.data;
}

// ============================================================================
// Storage Class
// ============================================================================

export class ContinuousLearningStorage {
	private readonly rootDir: string;
	private config: ContinuousLearningConfig;

	constructor(rootDir?: string) {
		this.rootDir = rootDir ?? join(homedir(), OMP_DIR, HOMUNCULUS_DIR);
		this.config = ContinuousLearningConfigSchema.parse({});
	}

	// -------------------------------------------------------------------------
	// Initialization
	// -------------------------------------------------------------------------

	/**
	 * Initialize storage directories and load config.
	 */
	async initialize(): Promise<void> {
		await mkdir(join(this.rootDir, PROJECTS_DIR), { recursive: true });
		await mkdir(join(this.rootDir, INSTINCTS_DIR, PERSONAL_DIR), { recursive: true });
		await mkdir(join(this.rootDir, INSTINCTS_DIR, INHERITED_DIR), { recursive: true });
		await mkdir(join(this.rootDir, EVOLVED_DIR, "skills"), { recursive: true });
		await mkdir(join(this.rootDir, EVOLVED_DIR, "commands"), { recursive: true });
		await mkdir(join(this.rootDir, EVOLVED_DIR, "agents"), { recursive: true });

		// Load config if exists
		await this.loadConfig();
	}

	/**
	 * Get or create project directory.
	 */
	async getProjectDir(projectId: string): Promise<string> {
		if (projectId === "global") {
			return this.rootDir;
		}
		const projectDir = join(this.rootDir, PROJECTS_DIR, projectId);
		await mkdir(join(projectDir, INSTINCTS_DIR, PERSONAL_DIR), { recursive: true });
		await mkdir(join(projectDir, INSTINCTS_DIR, INHERITED_DIR), { recursive: true });
		await mkdir(join(projectDir, "observations.archive"), { recursive: true });
		return projectDir;
	}

	// -------------------------------------------------------------------------
	// Config
	// -------------------------------------------------------------------------

	async loadConfig(): Promise<ContinuousLearningConfig> {
		const configPath = join(this.rootDir, CONFIG_FILE);
		try {
			const content = await readFile(configPath, "utf8");
			const parsed = JSON.parse(content);
			this.config = ContinuousLearningConfigSchema.parse(parsed);
		} catch {
			this.config = ContinuousLearningConfigSchema.parse({});
		}
		return this.config;
	}

	async saveConfig(config: ContinuousLearningConfig): Promise<void> {
		const validated = ContinuousLearningConfigSchema.parse(config);
		const configPath = join(this.rootDir, CONFIG_FILE);
		await atomicWriteFile(configPath, `${JSON.stringify(validated, null, 2)}\n`);
		this.config = validated;
		await this.audit("config_changed", { type: "config" });
	}

	getConfig(): ContinuousLearningConfig {
		return this.config;
	}

	// -------------------------------------------------------------------------
	// Observations
	// -------------------------------------------------------------------------

	/**
	 * Write an observation to the JSONL file.
	 * Handles rotation if file exceeds size limit.
	 */
	async writeObservation(observation: Omit<Observation, "id" | "checksum" | "schemaVersion">): Promise<string> {
		const id = uuid();
		const projectDir = await this.getProjectDir(observation.projectId);
		const obsPath = join(projectDir, OBSERVATIONS_FILE);

		// Create full observation
		const fullObs: Observation = {
			...observation,
			id,
			schemaVersion: SCHEMA_VERSION,
		};

		// Compute checksum
		const contentForChecksum = JSON.stringify({ ...fullObs, checksum: undefined });
		fullObs.checksum = computeChecksum(contentForChecksum);

		// Validate
		const validated = ObservationSchema.parse(fullObs);

		// Check file size and rotate if needed
		const sizeMb = await getFileSizeMb(obsPath);
		if (sizeMb >= this.config.maxObservationFileSizeMb) {
			await this.rotateObservations(projectDir);
		}

		// Append
		await appendJsonl(obsPath, validated);
		await this.audit("observation_created", { id, projectId: observation.projectId }, "observation");

		return id;
	}

	/**
	 * Rotate observations file to archive.
	 */
	async rotateObservations(projectDir: string): Promise<void> {
		const obsPath = join(projectDir, OBSERVATIONS_FILE);
		const archiveDir = join(projectDir, "observations.archive");
		await mkdir(archiveDir, { recursive: true });

		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const archivePath = join(archiveDir, `observations-${timestamp}.jsonl`);

		try {
			await rename(obsPath, archivePath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				throw error;
			}
		}

		await this.audit("storage_compacted", { archivePath }, "storage");
	}

	/**
	 * Read all observations for a project.
	 */
	async readObservations(projectId: string): Promise<Observation[]> {
		const projectDir = await this.getProjectDir(projectId);
		const obsPath = join(projectDir, OBSERVATIONS_FILE);
		return readJsonl<Observation>(obsPath);
	}

	/**
	 * Purge old archived observations.
	 */
	async purgeOldArchives(projectId: string): Promise<number> {
		const projectDir = await this.getProjectDir(projectId);
		const archiveDir = join(projectDir, "observations.archive");

		let purged = 0;
		try {
			const files = await readdir(archiveDir);
			const now = Date.now();
			const maxAge = this.config.archiveRetentionDays * 24 * 60 * 60 * 1000;

			for (const file of files) {
				const filePath = join(archiveDir, file);
				const stats = await stat(filePath);
				if (now - stats.mtimeMs > maxAge) {
					await rm(filePath);
					purged++;
				}
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				throw error;
			}
		}

		if (purged > 0) {
			await this.audit("storage_purged", { projectId, count: purged }, "storage");
		}

		return purged;
	}

	// -------------------------------------------------------------------------
	// Instincts
	// -------------------------------------------------------------------------

	/**
	 * Write an instinct to YAML file.
	 */
	async writeInstinct(instinct: Omit<Instinct, "checksum">): Promise<void> {
		// Compute checksum
		const fullInstinct: Instinct = {
			...instinct,
			checksum: computeChecksum(JSON.stringify({ ...instinct, checksum: undefined })),
		};

		// Validate
		const validated = InstinctSchema.parse(fullInstinct);

		// Determine directory
		const projectDir = await this.getProjectDir(validated.projectId ?? "global");
		const subDir = validated.source === "imported" ? INHERITED_DIR : PERSONAL_DIR;
		const instinctDir = validated.projectId
			? join(projectDir, INSTINCTS_DIR, subDir)
			: join(this.rootDir, INSTINCTS_DIR, subDir);

		const filePath = join(instinctDir, `${validated.id}.yaml`);
		const yaml = instinctToYaml(validated);
		await atomicWriteFile(filePath, yaml);

		await this.audit("instinct_created", { id: validated.id, projectId: validated.projectId }, "instinct");
	}

	/**
	 * Update an existing instinct.
	 */
	async updateInstinct(id: string, updates: Partial<Instinct>): Promise<Instinct | null> {
		const existing = await this.readInstinct(id);
		if (!existing) return null;

		const updated: Instinct = {
			...existing,
			...updates,
			id, // Preserve ID
			updatedAt: isoTimestamp(),
		};

		// Recompute checksum
		updated.checksum = computeChecksum(JSON.stringify({ ...updated, checksum: undefined }));

		await this.writeInstinct(updated);
		await this.audit("instinct_updated", { id, changes: Object.keys(updates) }, "instinct");

		return updated;
	}

	/**
	 * Read a single instinct by ID (searches all locations).
	 */
	async readInstinct(id: string, projectId?: string): Promise<Instinct | null> {
		const searchDirs: string[] = [];

		// Project-scoped locations
		if (projectId && projectId !== "global") {
			const projectDir = await this.getProjectDir(projectId);
			searchDirs.push(join(projectDir, INSTINCTS_DIR, PERSONAL_DIR), join(projectDir, INSTINCTS_DIR, INHERITED_DIR));
		}

		// Global locations
		searchDirs.push(
			join(this.rootDir, INSTINCTS_DIR, PERSONAL_DIR),
			join(this.rootDir, INSTINCTS_DIR, INHERITED_DIR),
		);

		for (const dir of searchDirs) {
			const filePath = join(dir, `${id}.yaml`);
			try {
				const content = await readFile(filePath, "utf8");
				return parseInstinctYaml(content);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
					throw error;
				}
			}
		}

		return null;
	}

	/**
	 * Read all instincts (project + global).
	 */
	async readAllInstincts(projectId?: string): Promise<Instinct[]> {
		const instincts: Instinct[] = [];
		const seenIds = new Set<string>();

		// Helper to read instincts from a directory
		const readFromDir = async (dir: string): Promise<void> => {
			try {
				const files = await readdir(dir);
				for (const file of files) {
					if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;

					const content = await readFile(join(dir, file), "utf8");
					const instinct = parseInstinctYaml(content);
					if (instinct && !seenIds.has(instinct.id)) {
						seenIds.add(instinct.id);
						instincts.push(instinct);
					}
				}
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
					throw error;
				}
			}
		};

		// Project-scoped instincts (higher priority)
		if (projectId && projectId !== "global") {
			const projectDir = await this.getProjectDir(projectId);
			await readFromDir(join(projectDir, INSTINCTS_DIR, PERSONAL_DIR));
			await readFromDir(join(projectDir, INSTINCTS_DIR, INHERITED_DIR));
		}

		// Global instincts
		await readFromDir(join(this.rootDir, INSTINCTS_DIR, PERSONAL_DIR));
		await readFromDir(join(this.rootDir, INSTINCTS_DIR, INHERITED_DIR));

		return instincts;
	}

	/**
	 * Delete an instinct.
	 */
	async deleteInstinct(id: string, projectId?: string): Promise<boolean> {
		const searchDirs: string[] = [];

		if (projectId && projectId !== "global") {
			const projectDir = await this.getProjectDir(projectId);
			searchDirs.push(join(projectDir, INSTINCTS_DIR, PERSONAL_DIR), join(projectDir, INSTINCTS_DIR, INHERITED_DIR));
		}

		searchDirs.push(
			join(this.rootDir, INSTINCTS_DIR, PERSONAL_DIR),
			join(this.rootDir, INSTINCTS_DIR, INHERITED_DIR),
		);

		for (const dir of searchDirs) {
			const filePath = join(dir, `${id}.yaml`);
			try {
				await rm(filePath);
				await this.audit("instinct_archived", { id, projectId }, "instinct");
				return true;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
					throw error;
				}
			}
		}

		return false;
	}

	// -------------------------------------------------------------------------
	// Project Registry
	// -------------------------------------------------------------------------

	async updateProjectRegistry(project: ProjectContext): Promise<void> {
		const validated = ProjectContextSchema.parse(project);
		const registryPath = join(this.rootDir, REGISTRY_FILE);

		let registry: Record<string, ProjectContext> = {};
		try {
			const content = await readFile(registryPath, "utf8");
			registry = JSON.parse(content);
		} catch {
			// Start fresh
		}

		registry[project.id] = validated;
		await atomicWriteFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
	}

	async readProjectRegistry(): Promise<Record<string, ProjectContext>> {
		const registryPath = join(this.rootDir, REGISTRY_FILE);
		try {
			const content = await readFile(registryPath, "utf8");
			return JSON.parse(content);
		} catch {
			return {};
		}
	}

	// -------------------------------------------------------------------------
	// Audit Log
	// -------------------------------------------------------------------------

	/**
	 * Write audit log entry.
	 */
	async audit(
		operation: AuditOperation,
		details?: Record<string, unknown>,
		targetType?: "observation" | "instinct" | "config" | "storage",
	): Promise<void> {
		const entry: AuditLogEntry = {
			id: uuid(),
			timestamp: isoTimestamp(),
			operation,
			targetType,
			targetId: details?.id as string | undefined,
			projectId: details?.projectId as string | undefined,
			details,
			status: "success",
		};

		entry.checksum = computeChecksum(JSON.stringify({ ...entry, checksum: undefined }));
		const validated = AuditLogEntrySchema.parse(entry);

		const auditPath = join(this.rootDir, AUDIT_LOG_FILE);
		await appendJsonl(auditPath, validated);
	}

	/**
	 * Read audit log entries.
	 */
	async readAuditLog(limit?: number): Promise<AuditLogEntry[]> {
		const auditPath = join(this.rootDir, AUDIT_LOG_FILE);
		const entries = await readJsonl<AuditLogEntry>(auditPath);
		if (limit) {
			return entries.slice(-limit);
		}
		return entries;
	}

	// -------------------------------------------------------------------------
	// Health Check
	// -------------------------------------------------------------------------

	/**
	 * Perform comprehensive health check.
	 */
	async healthCheck(): Promise<HealthCheckResult> {
		const startTime = Date.now();
		const checks: HealthCheckResult["checks"] = [];
		let overallStatus: "healthy" | "degraded" | "unhealthy" = "healthy";

		// Check 1: Root directory exists and is writable
		try {
			const testFile = join(this.rootDir, `.health-check-${Date.now()}`);
			await writeFile(testFile, "test");
			await rm(testFile);
			checks.push({ name: "storage_writable", status: "pass" });
		} catch (error) {
			checks.push({
				name: "storage_writable",
				status: "fail",
				message: `Storage not writable: ${(error as Error).message}`,
			});
			overallStatus = "unhealthy";
		}

		// Check 2: Config is valid
		try {
			await this.loadConfig();
			checks.push({ name: "config_valid", status: "pass" });
		} catch (error) {
			checks.push({
				name: "config_valid",
				status: "warn",
				message: `Config parse error: ${(error as Error).message}`,
			});
			overallStatus = overallStatus === "healthy" ? "degraded" : overallStatus;
		}

		// Check 3: Observations file integrity
		try {
			const obs = await this.readObservations("global");
			let valid = 0;
			let invalid = 0;
			for (const o of obs.slice(-100)) {
				const result = ObservationSchema.safeParse(o);
				if (result.success) valid++;
				else invalid++;
			}
			if (invalid > 0) {
				checks.push({
					name: "observations_integrity",
					status: "warn",
					message: `${invalid} of ${valid + invalid} recent observations have schema issues`,
				});
				overallStatus = overallStatus === "healthy" ? "degraded" : overallStatus;
			} else {
				checks.push({ name: "observations_integrity", status: "pass" });
			}
		} catch (error) {
			checks.push({
				name: "observations_integrity",
				status: "warn",
				message: `Cannot read observations: ${(error as Error).message}`,
			});
		}

		// Check 4: Instincts integrity
		try {
			const instincts = await this.readAllInstincts();
			let valid = 0;
			let invalid = 0;
			for (const i of instincts) {
				const result = InstinctSchema.safeParse(i);
				if (result.success) valid++;
				else invalid++;
			}
			if (invalid > 0) {
				checks.push({
					name: "instincts_integrity",
					status: "warn",
					message: `${invalid} of ${valid + invalid} instincts have schema issues`,
				});
				overallStatus = overallStatus === "healthy" ? "degraded" : overallStatus;
			} else {
				checks.push({ name: "instincts_integrity", status: "pass" });
			}
		} catch (error) {
			checks.push({
				name: "instincts_integrity",
				status: "warn",
				message: `Cannot read instincts: ${(error as Error).message}`,
			});
		}

		// Gather statistics
		let storage: HealthCheckResult["storage"];
		try {
			const obs = await this.readObservations("global");
			const instincts = await this.readAllInstincts();
			const projects = await this.readProjectRegistry();
			const audit = await this.readAuditLog();
			const obsPath = join(this.rootDir, OBSERVATIONS_FILE);

			storage = {
				observationsCount: obs.length,
				observationsFileSizeMb: await getFileSizeMb(obsPath),
				instinctsCount: instincts.length,
				projectsCount: Object.keys(projects).length,
				auditLogEntriesCount: audit.length,
			};
		} catch {
			// Statistics are optional
		}

		const result: HealthCheckResult = {
			timestamp: isoTimestamp(),
			status: overallStatus,
			checks,
			storage,
			schemaVersion: SCHEMA_VERSION,
		};

		// Log health check
		await this.audit("health_check", { status: overallStatus, durationMs: Date.now() - startTime });

		return result;
	}

	// -------------------------------------------------------------------------
	// Getters
	// -------------------------------------------------------------------------

	getRootDir(): string {
		return this.rootDir;
	}
}
