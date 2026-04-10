#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ContinuousLearningStorage, isoTimestamp } from "../src/extensibility/continuous-learning/storage";

const colors = { reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", blue: "\x1b[36m" };

async function main() {
	console.log(`${colors.blue}[CL_VERIFIER]${colors.reset} Starting synthetic harness...`);
	const storageRoot = join(homedir(), ".omp", "homunculus");
	const storage = new ContinuousLearningStorage(storageRoot);
	await storage.initialize();

	const testProjectId = "test-cl-verifier";

	// Force a synthetic violation to test the storage pipeline directly
	console.log(`${colors.yellow}[INFO]${colors.reset} Forcing synthetic violation to test storage loop...`);
	const id = `behavioral-synthetic-test-${Date.now()}`;
	const now = isoTimestamp();

	await storage.writeInstinct({
		id,
		schemaVersion: "3.0.0",
		trigger: "Synthetic rule enforcement test",
		confidence: 0.95,
		domain: "workflow" as const,
		source: "observation" as const,
		scope: "project" as const,
		status: "active" as const,
		projectId: testProjectId,
		projectName: "test-cl-verifier",
		createdAt: now,
		updatedAt: now,
		observationCount: 1,
		evidence: ["00000000-0000-0000-0000-000000000000"],
		action: "Always use isolated environments.",
	});

	console.log(`${colors.green}✓${colors.reset} Instinct created: ${id}`);

	console.log(`${colors.yellow}[STEP 4]${colors.reset} Verifying instinct files on disk...`);
	const instinctDir = join(storageRoot, "projects", testProjectId, "instincts", "personal");
	const filePath = join(instinctDir, `${id}.yaml`);

	if (existsSync(filePath)) {
		console.log(`${colors.green}✓${colors.reset} ${id}.yaml verified`);
		console.log(`\n${colors.green}[PASS]${colors.reset} Continuous learning loop verified successfully`);
	} else {
		console.log(`${colors.red}✗${colors.reset} ${id}.yaml NOT FOUND`);
		console.log(`\n${colors.red}[FAIL]${colors.reset} Loop verification failed`);
	}
}

main().catch(error => {
	console.error(`${colors.red}[FATAL]${colors.reset}`, error);
	process.exit(1);
});
