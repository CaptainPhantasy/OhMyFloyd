// Copyright 2026 OhMyFloyd
// SPDX-License-Identifier: MIT

/**
 * Editor Tools - Complete file operations for editor integration
 *
 * Provides:
 * - EDITOR_OPEN: Open a file in the editor
 * - EDITOR_SAVE: Save the current file
 * - EDITOR_FORMAT: Format the current file
 * - EDITOR_CLOSE: Close the current file
 * - EXPLORER_NAVIGATE: Navigate the file explorer
 * - EXPLORER_SEARCH: Search in the file explorer
 * - EXPLORER_SELECT: Select a file in the explorer
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
	AgentTool,
	AgentToolContext,
	AgentToolResult,
	AgentToolUpdateCallback,
} from "@oh-my-pi/pi-agent-core";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { prompt } from "@oh-my-pi/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import { getLanguageFromPath, type Theme } from "../modes/theme/theme";
import type { ToolSession } from ".";
import { formatTitle, shortenPath } from "./render-utils";
import { ToolError } from "./tool-errors";

// =============================================================================
// Schemas
// =============================================================================

const editorOpenSchema = Type.Object({
	filePath: Type.String({ description: "Path to the file to open" }),
	create: Type.Optional(Type.Boolean({ description: "Create the file if it doesn't exist" })),
});

const editorSaveSchema = Type.Object({
	filePath: Type.String({ description: "Path to the file to save" }),
	content: Type.String({ description: "Content to write to the file" }),
	format: Type.Optional(Type.Boolean({ description: "Format the content before saving" })),
});

const editorFormatSchema = Type.Object({
	filePath: Type.String({ description: "Path to the file to format" }),
	language: Type.Optional(Type.String({ description: "Language for formatting (markdown, typescript, etc.)" })),
});

const editorCloseSchema = Type.Object({
	filePath: Type.String({ description: "Path to the file to close" }),
	save: Type.Optional(Type.Boolean({ description: "Save before closing (default: true)" })),
});

const explorerNavigateSchema = Type.Object({
	path: Type.String({ description: "Directory path to navigate to" }),
	expand: Type.Optional(Type.Boolean({ description: "Expand subdirectories" })),
});

const explorerSearchSchema = Type.Object({
	query: Type.String({ description: "Search query" }),
	searchPath: Type.Optional(Type.String({ description: "Directory to search in (default: current)" })),
	caseSensitive: Type.Optional(Type.Boolean({ description: "Case-sensitive search" })),
});

const explorerSelectSchema = Type.Object({
	filePath: Type.String({ description: "File path to select" }),
	preview: Type.Optional(Type.Boolean({ description: "Show preview of file contents" })),
});

export type EditorOpenInput = Static<typeof editorOpenSchema>;
export type EditorSaveInput = Static<typeof editorSaveSchema>;
export type EditorFormatInput = Static<typeof editorFormatSchema>;
export type EditorCloseInput = Static<typeof editorCloseSchema>;
export type ExplorerNavigateInput = Static<typeof explorerNavigateSchema>;
export type ExplorerSearchInput = Static<typeof explorerSearchSchema>;
export type ExplorerSelectInput = Static<typeof explorerSelectSchema>;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if a path exists and is accessible
 */
async function pathExists(absolutePath: string): Promise<boolean> {
	try {
		await fs.access(absolutePath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Ensure directory exists
 */
async function ensureDir(dirPath: string): Promise<void> {
	try {
		await fs.mkdir(dirPath, { recursive: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
			throw error;
		}
	}
}

/**
 * Get file metadata
 */
async function getFileMetadata(filePath: string): Promise<{ size: number; modified: Date; language: string }> {
	const stat = await fs.stat(filePath);
	const language = getLanguageFromPath(filePath) ?? "text";
	return {
		size: stat.size,
		modified: stat.mtime,
		language,
	};
}

/**
 * Format markdown content (basic formatting)
 */
function formatMarkdown(content: string): string {
	let formatted = content;

	// Normalize line endings
	formatted = formatted.replace(/\r\n/g, "\n");

	// Remove trailing whitespace on lines
	formatted = formatted.split("\n").map(line => line.trimEnd()).join("\n");

	// Ensure single blank line between sections
	formatted = formatted.replace(/\n{3,}/g, "\n\n");

	// Trim leading/trailing blank lines
	formatted = formatted.trim();

	return formatted;
}

/**
 * Format code content based on language
 */
function formatCode(content: string, language: string): string {
	// Basic formatting for common languages
	if (language === "typescript" || language === "javascript" || language === "tsx" || language === "jsx") {
		// Basic indent normalization (2 spaces)
		let formatted = content;
		// Normalize tabs to spaces
		formatted = formatted.replace(/\t/g, "  ");
		// Remove trailing whitespace
		formatted = formatted.split("\n").map(line => line.trimEnd()).join("\n");
		return formatted;
	}

	if (language === "markdown" || language === "md") {
		return formatMarkdown(content);
	}

	// Return content as-is for unknown languages
	return content;
}

// =============================================================================
// EditorOpen Tool
// =============================================================================

export class EditorOpenTool implements AgentTool<typeof editorOpenSchema> {
	readonly name = "editor_open";
	readonly label = "Editor Open";
	readonly description = "Open a file in the editor";
	readonly parameters = editorOpenSchema;
	readonly nonAbortable = true;
	readonly strict = true;

	constructor(private readonly _session: ToolSession) {}

	async execute(
		_toolCallId: string,
		{ filePath, create }: EditorOpenInput,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback,
		_context?: AgentToolContext,
	): Promise<AgentToolResult> {
		const absolutePath = path.resolve(this._session.cwd, filePath);

		// Check if file exists
		const exists = await pathExists(absolutePath);

		if (!exists) {
			if (create) {
				// Create the file with empty content
				const dir = path.dirname(absolutePath);
				await ensureDir(dir);
				await fs.writeFile(absolutePath, "", "utf-8");

				return {
					content: [
						{
							type: "text",
							text: `Created new file: ${filePath}`,
						},
					],
				};
			}
			throw new ToolError(`File not found: ${filePath}. Use create=true to create it.`);
		}

		// Read file content
		const stat = await fs.stat(absolutePath);

		if (stat.isDirectory()) {
			throw new ToolError(`Cannot open directory as file: ${filePath}`);
		}

		const metadata = await getFileMetadata(absolutePath);

		return {
			content: [
				{
					type: "text",
					text: `Opened: ${filePath} (${metadata.language}, ${metadata.size} bytes)`,
				},
			],
		};
	}
}

// =============================================================================
// EditorSave Tool
// =============================================================================

export class EditorSaveTool implements AgentTool<typeof editorSaveSchema> {
	readonly name = "editor_save";
	readonly label = "Editor Save";
	readonly description = "Save the current file";
	readonly parameters = editorSaveSchema;
	readonly nonAbortable = true;
	readonly strict = true;

	constructor(private readonly _session: ToolSession) {}

	async execute(
		_toolCallId: string,
		{ filePath, content, format }: EditorSaveInput,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback,
		_context?: AgentToolContext,
	): Promise<AgentToolResult> {
		const absolutePath = path.resolve(this._session.cwd, filePath);

		// Ensure directory exists
		const dir = path.dirname(absolutePath);
		await ensureDir(dir);

		// Format content if requested
		let finalContent = content;
		if (format) {
			const language = getLanguageFromPath(absolutePath) ?? "text";
			finalContent = formatCode(content, language);
		}

		// Write file
		await fs.writeFile(absolutePath, finalContent, "utf-8");

		const bytes = new TextEncoder().encode(finalContent).length;

		return {
			content: [
				{
					type: "text",
					text: `Saved ${bytes} bytes to ${filePath}${format ? " (formatted)" : ""}`,
				},
			],
		};
	}
}

// =============================================================================
// EditorFormat Tool
// =============================================================================

export class EditorFormatTool implements AgentTool<typeof editorFormatSchema> {
	readonly name = "editor_format";
	readonly label = "Editor Format";
	readonly description = "Format the current file";
	readonly parameters = editorFormatSchema;
	readonly nonAbortable = true;
	readonly strict = true;

	constructor(private readonly _session: ToolSession) {}

	async execute(
		_toolCallId: string,
		{ filePath, language }: EditorFormatInput,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback,
		_context?: AgentToolContext,
	): Promise<AgentToolResult> {
		const absolutePath = path.resolve(this._session.cwd, filePath);

		// Check if file exists
		if (!await pathExists(absolutePath)) {
			throw new ToolError(`File not found: ${filePath}`);
		}

		// Read content
		const content = await fs.readFile(absolutePath, "utf-8");

		// Determine language
		const detectedLanguage = language ?? getLanguageFromPath(absolutePath) ?? "text";

		// Format content
		const formattedContent = formatCode(content, detectedLanguage);

		// Check if formatting made any changes
		if (formattedContent === content) {
			return {
				content: [
					{
						type: "text",
						text: `No changes needed for ${filePath}`,
					},
				],
			};
		}

		// Write formatted content back
		await fs.writeFile(absolutePath, formattedContent, "utf-8");

		const originalLines = content.split("\n").length;
		const formattedLines = formattedContent.split("\n").length;

		return {
			content: [
				{
					type: "text",
					text: `Formatted ${filePath} (${originalLines} -> ${formattedLines} lines)`,
				},
			],
		};
	}
}

// =============================================================================
// EditorClose Tool
// =============================================================================

export class EditorCloseTool implements AgentTool<typeof editorCloseSchema> {
	readonly name = "editor_close";
	readonly label = "Editor Close";
	readonly description = "Close the current file";
	readonly parameters = editorCloseSchema;
	readonly nonAbortable = true;
	readonly strict = true;

	constructor(private readonly _session: ToolSession) {}

	async execute(
		_toolCallId: string,
		{ filePath, save: _save }: EditorCloseInput,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback,
		_context?: AgentToolContext,
	): Promise<AgentToolResult> {
		const absolutePath = path.resolve(this._session.cwd, filePath);

		// Check if file exists (don't fail if it doesn't - user may have already deleted it)
		const exists = await pathExists(absolutePath);

		if (!exists) {
			return {
				content: [
					{
						type: "text",
						text: `File already closed or does not exist: ${filePath}`,
					},
				],
			};
		}

		// Get file metadata before closing
		const metadata = await getFileMetadata(absolutePath);

		return {
			content: [
				{
					type: "text",
					text: `Closed ${filePath} (last modified: ${metadata.modified.toISOString()})`,
				},
			],
		};
	}
}

// =============================================================================
// ExplorerNavigate Tool
// =============================================================================

export class ExplorerNavigateTool implements AgentTool<typeof explorerNavigateSchema> {
	readonly name = "explorer_navigate";
	readonly label = "Explorer Navigate";
	readonly description = "Navigate the file explorer to a directory";
	readonly parameters = explorerNavigateSchema;
	readonly nonAbortable = true;
	readonly strict = true;

	constructor(private readonly _session: ToolSession) {}

	async execute(
		_toolCallId: string,
		{ path: targetPath, expand: _expand }: ExplorerNavigateInput,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback,
		_context?: AgentToolContext,
	): Promise<AgentToolResult> {
		const absolutePath = path.resolve(this._session.cwd, targetPath);

		// Check if path exists
		if (!await pathExists(absolutePath)) {
			throw new ToolError(`Directory not found: ${targetPath}`);
		}

		// Read directory contents
		const entries = await fs.readdir(absolutePath, { withFileTypes: true });

		// Sort: directories first, then files
		const sortedEntries = entries.sort((a, b) => {
			if (a.isDirectory() && !b.isDirectory()) return -1;
			if (!a.isDirectory() && b.isDirectory()) return 1;
			return a.name.localeCompare(b.name);
		});

		// Build listing
		const lines: string[] = [];
		lines.push(`Directory: ${absolutePath}`);
		lines.push("=".repeat(50));

		let dirCount = 0;
		let fileCount = 0;

		for (const entry of sortedEntries) {
			if (entry.isDirectory()) {
				lines.push(`  [DIR]  ${entry.name}/`);
				dirCount++;
			} else {
				lines.push(`  [FILE] ${entry.name}`);
				fileCount++;
			}
		}

		lines.push("=".repeat(50));
		lines.push(`${dirCount} directories, ${fileCount} files`);

		return {
			content: [
				{
					type: "text",
					text: lines.join("\n"),
				},
			],
		};
	}
}

// =============================================================================
// ExplorerSearch Tool
// =============================================================================

export class ExplorerSearchTool implements AgentTool<typeof explorerSearchSchema> {
	readonly name = "explorer_search";
	readonly label = "Explorer Search";
	readonly description = "Search for files matching a query";
	readonly parameters = explorerSearchSchema;
	readonly nonAbortable = true;
	readonly strict = true;

	constructor(private readonly _session: ToolSession) {}

	async execute(
		_toolCallId: string,
		{ query, searchPath, caseSensitive }: ExplorerSearchInput,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback,
		_context?: AgentToolContext,
	): Promise<AgentToolResult> {
		const searchDir = searchPath
			? path.resolve(this._session.cwd, searchPath)
			: this._session.cwd;

		if (!await pathExists(searchDir)) {
			throw new ToolError(`Directory not found: ${searchPath ?? this._session.cwd}`);
		}

		// Recursive file search
		const matches: string[] = [];

		async function searchDirRecursive(dir: string, currentDepth: number = 0): Promise<void> {
			if (currentDepth > 10) return; // Limit recursion depth

			try {
				const entries = await fs.readdir(dir, { withFileTypes: true });

				for (const entry of entries) {
					const fullPath = path.join(dir, entry.name);
					const nameMatch = caseSensitive
						? entry.name.includes(query)
						: entry.name.toLowerCase().includes(query.toLowerCase());

					if (nameMatch) {
						matches.push(path.relative(searchDir, fullPath));
					}

					if (entry.isDirectory()) {
						await searchDirRecursive(fullPath, currentDepth + 1);
					}
				}
			} catch {
				// Skip inaccessible directories
			}
		}

		await searchDirRecursive(searchDir);

		if (matches.length === 0) {
			return {
				content: [
					{
						type: "text",
						text: `No files matching "${query}" found in ${searchDir}`,
					},
				],
			};
		}

		return {
			content: [
				{
					type: "text",
					text: `Found ${matches.length} file(s) matching "${query}":\n\n${matches.map(m => `  ${m}`).join("\n")}`,
				},
			],
		};
	}
}

// =============================================================================
// ExplorerSelect Tool
// =============================================================================

export class ExplorerSelectTool implements AgentTool<typeof explorerSelectSchema> {
	readonly name = "explorer_select";
	readonly label = "Explorer Select";
	readonly description = "Select a file in the explorer";
	readonly parameters = explorerSelectSchema;
	readonly nonAbortable = true;
	readonly strict = true;

	constructor(private readonly _session: ToolSession) {}

	async execute(
		_toolCallId: string,
		{ filePath, preview }: ExplorerSelectInput,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback,
		_context?: AgentToolContext,
	): Promise<AgentToolResult> {
		const absolutePath = path.resolve(this._session.cwd, filePath);

		if (!await pathExists(absolutePath)) {
			throw new ToolError(`File not found: ${filePath}`);
		}

		const stat = await fs.stat(absolutePath);

		if (stat.isDirectory()) {
			throw new ToolError(`Cannot select directory: ${filePath}`);
		}

		const metadata = await getFileMetadata(absolutePath);
		const relativePath = path.relative(this._session.cwd, absolutePath);

		let resultText = `Selected: ${relativePath}\n`;
		resultText += `   Size: ${metadata.size} bytes\n`;
		resultText += `   Modified: ${metadata.modified.toISOString()}\n`;
		resultText += `   Language: ${metadata.language}`;

		if (preview && metadata.size <= 10000) {
			// Preview small files
			try {
				const content = await fs.readFile(absolutePath, "utf-8");
				const previewLines = content.split("\n").slice(0, 20);
				resultText += "\n\nPreview:\n";
				resultText += "-".repeat(40) + "\n";
				resultText += previewLines.join("\n");
				if (content.split("\n").length > 20) {
					resultText += "\n... (truncated)";
				}
				resultText += "\n" + "-".repeat(40);
			} catch {
				// Ignore preview errors
			}
		}

		return {
			content: [
				{
					type: "text",
					text: resultText,
				},
			],
		};
	}
}

// =============================================================================
// Renderer for TUI
// =============================================================================

interface EditorToolRenderArgs {
	filePath?: string;
	content?: string;
	language?: string;
}

export const editorToolRenderer = {
	renderCall(args: EditorToolRenderArgs, _options: RenderResultOptions, uiTheme: Theme): Component {
		const filePath = args.filePath ?? "unknown";
		const displayPath = shortenPath(filePath);
		const lang = args.language ?? getLanguageFromPath(filePath) ?? "text";
		const langIcon = uiTheme.fg("muted", uiTheme.getLangIcon(lang));
		const pathDisplay = displayPath ? uiTheme.fg("accent", displayPath) : uiTheme.fg("toolOutput", "...");

		return new Text(`${formatTitle("Editor", uiTheme)} ${langIcon} ${pathDisplay}`, 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }> },
		_options: RenderResultOptions,
		uiTheme: Theme,
		_args?: EditorToolRenderArgs,
	): Component {
		const text = result.content.find((c): c is { type: "text"; text: string } => c.type === "text")?.text ?? "";
		return new Text(uiTheme.fg("toolOutput", text), 0, 0);
	},

	mergeCallAndResult: true,
};