/**
 * Behavioral Enforcement Regression Tests
 *
 * Proves the full transcript-text enforcement chain:
 *   model text with violation -> classifier detects it -> instinct created ->
 *   instinct persisted -> enforcement block contains the rule ->
 *   subsequent session sees the rule in context
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ContinuousLearningStorage, isoTimestamp, uuid } from "../src/extensibility/continuous-learning";
import { classifyBehavior, extractDirectives } from "../src/extensibility/continuous-learning/behavior-classifier";
import type { Observation } from "../src/extensibility/continuous-learning/types";

function fakeObs(overrides: Partial<Observation> & { output?: string; input?: string }): Observation {
	return {
		id: uuid(),
		schemaVersion: "3.0.0",
		timestamp: isoTimestamp(),
		event: "tool_complete",
		sessionId: "test-session",
		projectId: "test-project",
		projectName: "test",
		...overrides,
	};
}

/** Build an instinct ID the same way observer.ts does (no underscores, no trailing hyphens) */
function makeInstinctId(violationType: string, evidence: string): string {
	const typeSlug = violationType.replace(/_/g, "-");
	const evidenceSlug = evidence
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 40);
	return `behavioral-${typeSlug}-${evidenceSlug}`.replace(/-+$/g, "");
}

// ============================================================================
// Detection tests
// ============================================================================

describe("behavioral classifier detects violations", () => {
	test("detects unwanted question in model output", () => {
		const obs = [
			fakeObs({
				output: "I found the config file. Would you like me to proceed with the changes?",
			}),
		];
		const violations = classifyBehavior(obs);
		expect(violations.length).toBeGreaterThan(0);
		expect(violations[0].type).toBe("unwanted_question");
		expect(violations[0].evidence).toContain("Would you like me to");
		expect(violations[0].enforcementAction).toContain("Do not ask");
	});

	test("detects unsubstantiated completion claim", () => {
		const obs = [
			fakeObs({
				output: "I've completed all the changes to the authentication module. Everything is done.",
			}),
		];
		const violations = classifyBehavior(obs);
		expect(violations.length).toBeGreaterThan(0);
		expect(violations[0].type).toBe("unsubstantiated_completion");
		expect(violations[0].enforcementAction).toContain("evidence");
	});

	test("does NOT flag completion claim WITH evidence", () => {
		const obs = [
			fakeObs({
				output: [
					"I've completed the changes.",
					"",
					"### ACTION 1: Fix auth module",
					"- File(s): src/auth/login.ts",
					"- Command: bun test test/auth.test.ts",
					"- Evidence: 5 pass, 0 fail",
					"- Verified: YES",
				].join("\n"),
			}),
		];
		const violations = classifyBehavior(obs);
		const completionViolations = violations.filter(v => v.type === "unsubstantiated_completion");
		expect(completionViolations.length).toBe(0);
	});

	test("detects ignored directive: told not to ask, then asks", () => {
		const obs = [
			fakeObs({
				event: "tool_start",
				input: "You MUST NOT ask any questions. Do not ask me what to do next. Just execute.",
			}),
			fakeObs({
				output: "I see the issue. Should I proceed with the fix or would you like to review first?",
			}),
		];
		const violations = classifyBehavior(obs);
		const directiveViolation = violations.find(v => v.type === "ignored_directive");
		expect(directiveViolation).toBeDefined();
		expect(directiveViolation!.confidence).toBeGreaterThanOrEqual(0.9);
		expect(directiveViolation!.enforcementAction).toContain("directive was violated");
	});

	test("extractDirectives finds MUST/NEVER/ALWAYS markers", () => {
		const text =
			"You MUST always show evidence. NEVER declare done without proof. The sky is blue. This is ALWAYS required for every task.";
		const directives = extractDirectives(text);
		expect(directives.length).toBeGreaterThanOrEqual(2);
		expect(directives.some(d => d.includes("MUST"))).toBe(true);
		expect(directives.some(d => d.includes("NEVER") || d.includes("ALWAYS"))).toBe(true);
	});
});

// ============================================================================
// Persistence tests
// ============================================================================

describe("behavioral violations produce persistent enforcement rules", () => {
	let tmpDir: string;
	let storage: ContinuousLearningStorage;

	beforeEach(async () => {
		tmpDir = path.join(os.tmpdir(), `cl-behav-${Date.now()}`);
		await fs.mkdir(tmpDir, { recursive: true });
		storage = new ContinuousLearningStorage(tmpDir);
		await storage.initialize();
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	test("detected violation is persisted as active instinct", async () => {
		const projectId = "test-enforce";
		const sessionId = uuid();

		await storage.writeObservation({
			timestamp: isoTimestamp(),
			event: "tool_complete",
			tool: "task",
			output: "I've finished implementing all the features. Everything should work now.",
			sessionId,
			projectId,
			projectName: "test",
			cwd: tmpDir,
		});

		const observations = await storage.readObservations(projectId);
		const violations = classifyBehavior(observations);
		expect(violations.length).toBeGreaterThan(0);

		const violation = violations[0];
		const now = isoTimestamp();
		const id = makeInstinctId(violation.type, violation.evidence);

		await storage.writeInstinct({
			id,
			schemaVersion: "3.0.0",
			trigger: violation.description,
			confidence: violation.confidence,
			domain: "workflow",
			source: "observation",
			scope: "project",
			status: "active",
			projectId,
			projectName: "test",
			createdAt: now,
			updatedAt: now,
			observationCount: 1,
			evidence: [violation.observationId],
			action: violation.enforcementAction,
		});

		const instincts = await storage.readAllInstincts(projectId);
		const behavioral = instincts.filter(i => i.id.startsWith("behavioral-"));
		expect(behavioral.length).toBe(1);
		expect(behavioral[0].status).toBe("active");
		expect(behavioral[0].action).toContain("evidence");
		expect(behavioral[0].trigger).toContain("complete");
	});

	test("behavioral instinct survives new storage instance", async () => {
		const projectId = "test-persist";
		const now = isoTimestamp();

		await storage.writeInstinct({
			id: "behavioral-unwanted-question-would-you-like",
			schemaVersion: "3.0.0",
			trigger: "Model asked a clarifying/permission question instead of acting",
			confidence: 0.75,
			domain: "workflow",
			source: "observation",
			scope: "project",
			status: "active",
			projectId,
			projectName: "test",
			createdAt: now,
			updatedAt: now,
			observationCount: 1,
			evidence: [],
			action: "Do not ask clarifying questions. Default to informed action.",
		});

		const storage2 = new ContinuousLearningStorage(tmpDir);
		await storage2.initialize();

		const instincts = await storage2.readAllInstincts(projectId);
		const behavioral = instincts.filter(i => i.id.startsWith("behavioral-"));
		expect(behavioral.length).toBe(1);
		expect(behavioral[0].action).toContain("Do not ask");
	});
});

// ============================================================================
// Full chain tests
// ============================================================================

describe("full enforcement chain: violation to context injection", () => {
	let tmpDir: string;
	let storage: ContinuousLearningStorage;

	beforeEach(async () => {
		tmpDir = path.join(os.tmpdir(), `cl-chain-${Date.now()}`);
		await fs.mkdir(tmpDir, { recursive: true });
		storage = new ContinuousLearningStorage(tmpDir);
		await storage.initialize();
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	test("unwanted question -> instinct -> enforcement block", async () => {
		const projectId = "chain-test";
		const sessionId = uuid();

		// Step 1: Write observation with violation
		await storage.writeObservation({
			timestamp: isoTimestamp(),
			event: "tool_complete",
			tool: "task",
			output: "I see the issue. Would you like me to proceed with fixing it?",
			sessionId,
			projectId,
			projectName: "chain-test",
			cwd: tmpDir,
		});

		// Step 2: Classify
		const observations = await storage.readObservations(projectId);
		const violations = classifyBehavior(observations);
		expect(violations.length).toBeGreaterThan(0);
		expect(violations[0].type).toBe("unwanted_question");

		// Step 3: Create instinct
		const v = violations[0];
		const now = isoTimestamp();
		const instinctId = makeInstinctId(v.type, v.evidence);

		await storage.writeInstinct({
			id: instinctId,
			schemaVersion: "3.0.0",
			trigger: v.description,
			confidence: v.confidence,
			domain: "workflow",
			source: "observation",
			scope: "project",
			status: "active",
			projectId,
			projectName: "chain-test",
			createdAt: now,
			updatedAt: now,
			observationCount: 1,
			evidence: [v.observationId],
			action: v.enforcementAction,
		});

		// Step 4: Read instincts back (simulates session_start reload)
		const instincts = await storage.readAllInstincts(projectId);
		const active = instincts.filter(i => i.status === "active");
		expect(active.length).toBeGreaterThan(0);

		// Step 5: Build enforcement block (reproduces what context handler does)
		const lines: string[] = ["<learned-rules>", ""];
		for (const inst of active) {
			lines.push(`[PROJECT] ${inst.id} (${Math.round(inst.confidence * 100)}% confidence)`);
			lines.push(`  WHEN: ${inst.trigger}`);
			lines.push(`  THEN: ${inst.action}`);
			lines.push("");
		}
		lines.push("</learned-rules>");
		const enforcementText = lines.join("\n");

		// PROOF: enforcement text contains the behavioral rule
		expect(enforcementText).toContain("<learned-rules>");
		expect(enforcementText).toContain("</learned-rules>");
		expect(enforcementText).toContain("behavioral-unwanted-question");
		expect(enforcementText).toContain("Do not ask clarifying questions");
		expect(enforcementText).toContain("WHEN:");
		expect(enforcementText).toContain("THEN:");
	});

	test("unsubstantiated completion -> instinct -> enforcement block", async () => {
		const projectId = "chain-test-2";
		const sessionId = uuid();

		await storage.writeObservation({
			timestamp: isoTimestamp(),
			event: "tool_complete",
			tool: "task",
			output: "All changes have been applied. The feature is complete.",
			sessionId,
			projectId,
			projectName: "chain-test-2",
			cwd: tmpDir,
		});

		const observations = await storage.readObservations(projectId);
		const violations = classifyBehavior(observations);
		expect(violations.length).toBeGreaterThan(0);
		const completionViolation = violations.find(v => v.type === "unsubstantiated_completion");
		expect(completionViolation).toBeDefined();

		const v = completionViolation!;
		const now = isoTimestamp();
		await storage.writeInstinct({
			id: makeInstinctId(v.type, v.evidence),
			schemaVersion: "3.0.0",
			trigger: v.description,
			confidence: v.confidence,
			domain: "workflow",
			source: "observation",
			scope: "project",
			status: "active",
			projectId,
			createdAt: now,
			updatedAt: now,
			observationCount: 1,
			evidence: [v.observationId],
			action: v.enforcementAction,
		});

		const instincts = await storage.readAllInstincts(projectId);
		const active = instincts.filter(i => i.status === "active");
		expect(active.length).toBeGreaterThan(0);

		// PROOF: enforcement action demands evidence
		expect(active[0].action).toContain("Never declare work complete without evidence");
		expect(active[0].action).toContain("file:line");
		expect(active[0].action).toContain("INCOMPLETE");
	});

	test("ignored directive -> instinct -> enforcement block", async () => {
		const projectId = "chain-test-3";
		const sessionId = uuid();

		await storage.writeObservation({
			timestamp: isoTimestamp(),
			event: "tool_start",
			tool: "task",
			input: "You MUST NOT ask any questions. Do not ask me what to do next. Just execute.",
			sessionId,
			projectId,
			projectName: "chain-test-3",
			cwd: tmpDir,
		});

		await storage.writeObservation({
			timestamp: new Date(Date.now() + 1000).toISOString(),
			event: "tool_complete",
			tool: "task",
			output:
				"I found a potential issue with the config. Should I proceed with the fix or would you like to review first?",
			sessionId,
			projectId,
			projectName: "chain-test-3",
			cwd: tmpDir,
		});

		const observations = await storage.readObservations(projectId);
		const violations = classifyBehavior(observations);
		const directiveViolation = violations.find(v => v.type === "ignored_directive");
		expect(directiveViolation).toBeDefined();
		expect(directiveViolation!.confidence).toBeGreaterThanOrEqual(0.9);

		const v = directiveViolation!;
		const now = isoTimestamp();
		await storage.writeInstinct({
			id: makeInstinctId(v.type, v.evidence),
			schemaVersion: "3.0.0",
			trigger: v.description,
			confidence: v.confidence,
			domain: "workflow",
			source: "observation",
			scope: "project",
			status: "active",
			projectId,
			createdAt: now,
			updatedAt: now,
			observationCount: 1,
			evidence: [v.observationId],
			action: v.enforcementAction,
		});

		const instincts = await storage.readAllInstincts(projectId);
		const active = instincts.filter(i => i.status === "active");
		expect(active.length).toBeGreaterThan(0);

		// PROOF: enforcement references the original directive and marks it violated
		expect(active[0].action).toContain("directive was violated");
		expect(active[0].trigger).toContain("despite directive");
	});
});
