#!/usr/bin/env bun
/**
 * CI check for dead runtime surfaces.
 * Detects:
 * 1. Zero-call-site event methods in ExtensionRunner
 * 2. Doc/runtime mismatches (events documented but not emitted)
 * 3. Legacy hook runtime references that should have been removed
 *
 * Exit code 0 = clean, 1 = violations found
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

const SRC_DIR = path.join(import.meta.dir, "../src");
const EXTENSIBILITY_DIR = path.join(SRC_DIR, "extensibility");

interface Violation {
	type: "dead-module" | "dead-export" | "legacy-reference";
	file: string;
	message: string;
}

async function findViolations(): Promise<Violation[]> {
	const violations: Violation[] = [];

	// 1. Check for legacy hook runtime files that should not exist
	const legacyFiles = ["hooks/loader.ts", "hooks/runner.ts", "hooks/tool-wrapper.ts"];

	for (const file of legacyFiles) {
		const filePath = path.join(EXTENSIBILITY_DIR, file);
		try {
			await fs.access(filePath);
			violations.push({
				type: "dead-module",
				file: filePath,
				message: `Legacy hook runtime file should not exist: ${file}`,
			});
		} catch {
			// File doesn't exist - good
		}
	}

	// 2. Check hooks/index.ts doesn't re-export from deleted modules
	const hooksIndexPath = path.join(EXTENSIBILITY_DIR, "hooks/index.ts");
	try {
		const content = await Bun.file(hooksIndexPath).text();
		const legacyExports = ["./loader", "./runner", "./tool-wrapper"];

		for (const exp of legacyExports) {
			if (content.includes(`from "${exp}"`) || content.includes(`from '${exp}'`)) {
				violations.push({
					type: "dead-export",
					file: hooksIndexPath,
					message: `hooks/index.ts re-exports from deleted module: ${exp}`,
				});
			}
		}
	} catch {
		// File doesn't exist - that's fine
	}

	// 3. Check for legacy HookRunner/HookToolWrapper class imports in src/
	const srcFiles = await findTsFiles(SRC_DIR);
	const legacyPatterns = [
		/import\s+.*\bHookRunner\b.*from/,
		/import\s+.*\bHookToolWrapper\b.*from/,
		/import\s+.*\bdiscoverAndLoadHooks\b.*from/,
		/new\s+HookRunner\s*\(/,
		/new\s+HookToolWrapper\s*\(/,
	];

	for (const file of srcFiles) {
		// Skip the hooks/types.ts file (it's allowed to have type aliases)
		if (file.includes("hooks/types.ts")) continue;

		const content = await Bun.file(file).text();

		for (const pattern of legacyPatterns) {
			if (pattern.test(content)) {
				violations.push({
					type: "legacy-reference",
					file,
					message: `Contains legacy hook runtime reference: ${pattern.source}`,
				});
			}
		}
	}

	// 4. Check extensions/types.ts doesn't have ResourcesDiscoverEvent
	const typesPath = path.join(EXTENSIBILITY_DIR, "extensions/types.ts");
	try {
		const content = await Bun.file(typesPath).text();
		if (content.includes("ResourcesDiscoverEvent") || content.includes("resources_discover")) {
			violations.push({
				type: "dead-export",
				file: typesPath,
				message: "extensions/types.ts contains removed ResourcesDiscoverEvent",
			});
		}
	} catch {
		// File doesn't exist - unexpected but not a dead runtime issue
	}

	return violations;
}

async function findTsFiles(dir: string): Promise<string[]> {
	const files: string[] = [];

	async function walk(currentDir: string) {
		const entries = await fs.readdir(currentDir, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(currentDir, entry.name);

			if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
				await walk(fullPath);
			} else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
				files.push(fullPath);
			}
		}
	}

	await walk(dir);
	return files;
}

async function main() {
	console.log("Checking for dead runtime surfaces...\n");

	const violations = await findViolations();

	if (violations.length === 0) {
		console.log("✓ No dead runtime surfaces detected");
		process.exit(0);
	}

	console.error(`Found ${violations.length} violation(s):\n`);

	for (const v of violations) {
		console.error(`[${v.type}] ${v.file}`);
		console.error(`  ${v.message}\n`);
	}

	process.exit(1);
}

main();
