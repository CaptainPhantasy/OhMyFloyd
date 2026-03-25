import * as path from "node:path";
import { resolveToCwd } from "../tools/path-utils";

export interface PathValidationOptions {
	cwd: string;
	allowOutsideCwd?: boolean;
}

export interface PathValidationResult {
	ok: boolean;
	input: string;
	resolvedPath?: string;
	reason?: string;
}

export function validatePath(input: string, options: PathValidationOptions): PathValidationResult {
	const trimmed = input.trim();
	if (trimmed.length === 0) {
		return { ok: false, input, reason: "Path must not be empty." };
	}

	const resolvedPath = resolveToCwd(trimmed, options.cwd);
	const relative = path.relative(options.cwd, resolvedPath);
	const escapesCwd =
		relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);

	if (escapesCwd && !options.allowOutsideCwd) {
		return {
			ok: false,
			input,
			resolvedPath,
			reason: "Path escapes the current workspace.",
		};
	}

	return { ok: true, input, resolvedPath };
}

export function assertValidPath(input: string, options: PathValidationOptions): string {
	const result = validatePath(input, options);
	if (!result.ok || !result.resolvedPath) {
		throw new Error(result.reason ?? "Path validation failed.");
	}
	return result.resolvedPath;
}
