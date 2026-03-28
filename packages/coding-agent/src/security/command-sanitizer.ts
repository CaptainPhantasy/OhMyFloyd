const DEFAULT_DENY_PATTERNS: ReadonlyArray<RegExp> = [
	/(^|[;&|()]\s*)(?:bash|sh)\b/,
	/(^|[;&|()]\s*)(?:python|python3|node|perl|ruby|php)\b/,
	/(^|[;&|()]\s*)(?:mv|cp|rm|mkdir|touch|chmod|chown|ln|install|patch)\b/,
	/(^|[;&|()]\s*)sed\s+-i\b/,
	/(^|[;&|()]\s*)git\s+(?:add|apply|checkout|clean|commit|merge|rebase|reset|restore|revert|stash|switch|worktree)\b/,
	/(^|[^<])>>?/,
	/\|\s*tee\b/,
	/<<<?/,
];

export interface CommandSanitizerOptions {
	allowEmpty?: boolean;
	denyPatterns?: ReadonlyArray<RegExp>;
}

export interface CommandSanitizationResult {
	ok: boolean;
	command: string;
	reason?: string;
}

export function sanitizeCommand(command: string, options: CommandSanitizerOptions = {}): CommandSanitizationResult {
	const trimmed = command.trim();
	if (trimmed.length === 0) {
		return options.allowEmpty
			? { ok: true, command: trimmed }
			: { ok: false, command: trimmed, reason: "Command must not be empty." };
	}

	const denyPatterns = options.denyPatterns ?? DEFAULT_DENY_PATTERNS;
	if (denyPatterns.some(pattern => pattern.test(trimmed))) {
		return {
			ok: false,
			command: trimmed,
			reason:
				"Command rejected by sanitizer. Use structured file tools for mutations and keep shell commands read-only.",
		};
	}

	return { ok: true, command: trimmed };
}

export function assertSafeCommand(command: string, options?: CommandSanitizerOptions): string {
	const result = sanitizeCommand(command, options);
	if (!result.ok) {
		throw new Error(result.reason ?? "Command rejected by sanitizer.");
	}
	return result.command;
}
