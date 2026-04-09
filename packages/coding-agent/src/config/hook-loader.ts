/**
 * Hook loader - discovers and loads hook rules from ~/.omp/hooks/*.json
 * Hook rules are pattern-based guards that can:
 * - BLOCK: Prevent tool execution entirely
 * - WARN: Show warning but allow execution
 * - ACTION: Trigger an ASK tool call
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

export interface HookRule {
	hook_name: string;
	event: "PreToolUse" | "PostToolUse" | string;
	description: string;
	pattern: string;
	action: "block" | "warn" | "action";
	message?: string;
}

export interface HookCheckResult {
	matched: boolean;
	rule?: HookRule;
	message?: string;
}

export class HookLoader {
	private static instance: HookLoader;
	private rules: HookRule[] = [];
	private initialized = false;

	private constructor() {}

	static getInstance(): HookLoader {
		if (!HookLoader.instance) {
			HookLoader.instance = new HookLoader();
		}
		return HookLoader.instance;
	}

	/**
	 * Initialize hook loader by discovering and loading all hook JSON files
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return;

		const homeDir = process.env.HOME;
		if (!homeDir) {
			logger.debug("HOME not set, skipping hook loader initialization");
			return;
		}

		const hooksDir = path.join(homeDir, ".omp", "hooks");

		try {
			// Check if hooks directory exists
			const stats = await fs.promises.stat(hooksDir);
			if (!stats.isDirectory()) {
				logger.debug(`Hook directory not a directory: ${hooksDir}`);
				this.initialized = true;
				return;
			}

			// List all JSON files in hooks directory
			const files = await fs.promises.readdir(hooksDir);
			const jsonFiles = files.filter(f => f.endsWith(".json"));

			logger.debug(`Found ${jsonFiles.length} hook files in ${hooksDir}`);

			// Load each hook file
			for (const file of jsonFiles) {
				const filePath = path.join(hooksDir, file);
				try {
					const content = await fs.promises.readFile(filePath, "utf-8");
					const hookRules = JSON.parse(content) as HookRule[];

					if (Array.isArray(hookRules)) {
						this.rules.push(...hookRules);
						logger.debug(`Loaded ${hookRules.length} rules from ${file}`);
					}
				} catch (err) {
					logger.warn(`Failed to load hook file ${file}: ${err instanceof Error ? err.message : String(err)}`);
				}
			}

			logger.debug(`Hook loader initialized with ${this.rules.length} total rules`);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
				logger.warn(`Failed to initialize hook loader: ${err instanceof Error ? err.message : String(err)}`);
			}
		}

		this.initialized = true;
	}

	/**
	 * Check if a bash command matches any PreToolUse hook rules
	 */
	checkBashCommand(command: string): HookCheckResult {
		// Filter for PreToolUse hooks that apply to bash
		const applicableRules = this.rules.filter(rule => rule.event === "PreToolUse");

		for (const rule of applicableRules) {
			try {
				const regex = new RegExp(rule.pattern);
				if (regex.test(command)) {
					logger.debug(`Hook rule matched: ${rule.hook_name}`);
					return {
						matched: true,
						rule,
						message: rule.message,
					};
				}
			} catch (_err) {
				logger.warn(`Invalid hook pattern in ${rule.hook_name}: ${rule.pattern}`);
			}
		}

		return { matched: false };
	}

	/**
	 * Get all loaded rules (for debugging/inspection)
	 */
	getRules(): HookRule[] {
		return [...this.rules];
	}

	/**
	 * Get rules count
	 */
	getRulesCount(): number {
		return this.rules.length;
	}
}

export const hookLoader = HookLoader.getInstance();
