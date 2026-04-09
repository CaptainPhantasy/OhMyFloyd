import * as path from "node:path";
import { theme } from "../modes/theme/theme";
import { expandPath } from "../tools/path-utils";
import type { ExtensionUIContext } from "./extensions/types";

/**
 * Resolve a file path:
 * - Absolute paths used as-is
 * - Paths starting with ~ expanded to home directory
 * - Relative paths resolved from cwd
 */
export function resolvePath(filePath: string, cwd: string): string {
	const expanded = expandPath(filePath);
	if (path.isAbsolute(expanded)) {
		return expanded;
	}
	return path.resolve(cwd, expanded);
}

/**
 * Create a no-op UI context for headless modes.
 */
export function createNoOpUIContext(): ExtensionUIContext {
	return {
		select: async () => undefined,
		confirm: async () => false,
		input: async () => undefined,
		notify: () => {},
		onTerminalInput: () => () => {},
		setStatus: () => {},
		setWorkingMessage: () => {},
		setWidget: () => {},
		setFooter: () => {},
		setHeader: () => {},
		setTitle: () => {},
		custom: async () => undefined as never,
		setEditorText: () => {},
		pasteToEditor: () => {},
		getEditorText: () => "",
		editor: async () => undefined,
		setEditorComponent: () => {},
		get theme() {
			return theme;
		},
		getAllThemes: () => Promise.resolve([]),
		getTheme: () => Promise.resolve(undefined),
		setTheme: () => Promise.resolve({ success: false }),
		getToolsExpanded: () => false,
		setToolsExpanded: () => {},
	};
}
