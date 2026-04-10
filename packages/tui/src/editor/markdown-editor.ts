// Copyright 2026 OhMyFloyd
// SPDX-License-Identifier: MIT

import { EventEmitter } from "events";
import { type Model } from "@oh-my-pi/pi-ai";
import {
	type EditorState,
	type AIAssistant,
	type EditorPlugin,
	type MarkdownEditorOptions,
	type EditorError,
} from "./types.js";
import {
	generateContent,
	getContextAwareSuggestion,
	autoFormatDocument,
	analyzeDocument,
	clearAICache,
} from "./ai-assistant.js";

/**
 * MarkdownEditor: A feature-rich markdown editor with AI-assisted capabilities.
 *
 * Features:
 * - Full cursor and selection management
 * - Undo/redo with state history
 * - AI-powered completions and suggestions
 * - Syntax highlighting (ANSI escape codes for terminal)
 * - Keyboard shortcuts for common operations
 * - Plugin system for extensibility
 * - Accessibility support
 * - Performance optimization for large files
 */
export class MarkdownEditor extends EventEmitter {
	#state: EditorState;
	#undoStack: EditorState[] = [];
	#redoStack: EditorState[] = [];
	#aiServiceAvailable: boolean = true;
	#maxHistorySize: number = 100;
	#model: Model | null = null;

	#aiAssistant: AIAssistant;
	#plugins: EditorPlugin[] = [];

	constructor(options: MarkdownEditorOptions = {}) {
		super();

		// Handle corrupted or invalid initial content
		let initialContent = options.initialContent || "";
		if (typeof initialContent !== "string") {
			console.warn("Invalid initial content provided, defaulting to empty string");
			initialContent = "";
		}
		// Basic sanitization to prevent XSS
		initialContent = initialContent.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");

		this.#state = {
			content: initialContent,
			cursor: 0,
			selectionStart: null,
			selectionEnd: null,
		};
		this.#aiServiceAvailable = options.aiServiceAvailable ?? true;
		this.#aiAssistant = {
			getSmartCompletion: this.getSmartCompletion.bind(this),
			getContextAwareSuggestion: this.getContextAwareSuggestion.bind(this),
			autoFormat: async (content: string) => {
				this.#state.content = content;
				await this.autoFormat();
				return this.#state.content;
			},
		};
		if (options.plugins) {
			this.#plugins = options.plugins;
			this.#plugins.forEach(plugin => plugin.setup(this));
		}
	}

	/**
	 * Set the AI model for completions
	 */
	setModel(model: Model): void {
		this.#model = model;
	}

	/**
	 * Get current editor state
	 */
	getState(): EditorState {
		return { ...this.#state };
	}

	/**
	 * Get AI assistant interface
	 */
	getAIAssistant(): AIAssistant {
		return this.#aiAssistant;
	}

	// =============================================================================
	// Content Management
	// =============================================================================

	getContent(): string {
		return this.#state.content;
	}

	setContent(content: string): void {
		try {
			if (typeof content !== "string") {
				throw new Error("Content must be a string");
			}
			// Basic sanitization to prevent XSS
			const sanitizedContent = content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
			this.saveState();
			this.#state.content = sanitizedContent;
			// Adjust cursor if it's out of bounds
			this.#state.cursor = Math.min(this.#state.cursor, sanitizedContent.length);
			this.#state.selectionStart = null;
			this.#state.selectionEnd = null;
			this.emit("change", this.#state);
		} catch (error) {
			console.error("Failed to set content:", error);
			const editorError: EditorError = { message: "Failed to set content", error };
			this.emit("error", editorError);
		}
	}

	// =============================================================================
	// Cursor and Selection Management
	// =============================================================================

	/**
	 * Get current cursor position
	 */
	getCursor(): number {
		return this.#state.cursor;
	}

	/**
	 * Set cursor position
	 */
	setCursor(position: number): void {
		const validPosition = Math.max(0, Math.min(position, this.#state.content.length));
		if (this.#state.cursor !== validPosition) {
			this.#state.cursor = validPosition;
			// Clear selection when cursor moves
			this.#state.selectionStart = null;
			this.#state.selectionEnd = null;
			this.emit("cursorMove", this.#state);
		}
	}

	/**
	 * Get current selection range
	 */
	getSelection(): { start: number; end: number } | null {
		if (this.#state.selectionStart === null || this.#state.selectionEnd === null) {
			return null;
		}
		return {
			start: Math.min(this.#state.selectionStart, this.#state.selectionEnd),
			end: Math.max(this.#state.selectionStart, this.#state.selectionEnd),
		};
	}

	/**
	 * Set selection range
	 */
	setSelection(start: number, end: number): void {
		const validStart = Math.max(0, Math.min(start, this.#state.content.length));
		const validEnd = Math.max(0, Math.min(end, this.#state.content.length));
		this.#state.selectionStart = validStart;
		this.#state.selectionEnd = validEnd;
		this.#state.cursor = validEnd;
		this.emit("selectionChange", this.#state);
	}

	/**
	 * Clear current selection
	 */
	clearSelection(): void {
		if (this.#state.selectionStart !== null || this.#state.selectionEnd !== null) {
			this.#state.selectionStart = null;
			this.#state.selectionEnd = null;
			this.emit("selectionChange", this.#state);
		}
	}

	/**
	 * Select all content
	 */
	selectAll(): void {
		this.#state.selectionStart = 0;
		this.#state.selectionEnd = this.#state.content.length;
		this.#state.cursor = this.#state.content.length;
		this.emit("selectionChange", this.#state);
	}

	/**
	 * Move cursor by delta (positive = forward, negative = backward)
	 */
	moveCursor(delta: number): void {
		this.setCursor(this.#state.cursor + delta);
	}

	/**
	 * Move cursor to start of line
	 */
	moveCursorToLineStart(): void {
		const content = this.#state.content;
		const cursor = this.#state.cursor;
		const lineStart = content.lastIndexOf("\n", cursor - 1) + 1;
		this.setCursor(lineStart);
	}

	/**
	 * Move cursor to end of line
	 */
	moveCursorToLineEnd(): void {
		const content = this.#state.content;
		const cursor = this.#state.cursor;
		const lineEnd = content.indexOf("\n", cursor);
		this.setCursor(lineEnd === -1 ? content.length : lineEnd);
	}

	// =============================================================================
	// Text Operations
	// =============================================================================

	/**
	 * Insert text at current cursor position
	 */
	insertText(text: string): void {
		try {
			if (typeof text !== "string") {
				throw new Error("Text must be a string");
			}
			// Basic sanitization to prevent XSS
			const sanitizedText = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");

			const selection = this.getSelection();
			this.saveState();

			if (selection) {
				// Replace selection
				this.#state.content =
					this.#state.content.substring(0, selection.start) +
					sanitizedText +
					this.#state.content.substring(selection.end);
				this.#state.cursor = selection.start + sanitizedText.length;
			} else {
				// Insert at cursor
				this.#state.content =
					this.#state.content.substring(0, this.#state.cursor) +
					sanitizedText +
					this.#state.content.substring(this.#state.cursor);
				this.#state.cursor += sanitizedText.length;
			}

			this.#state.selectionStart = null;
			this.#state.selectionEnd = null;
			this.emit("change", this.#state);
		} catch (error) {
			console.error("Failed to insert text:", error);
			const editorError: EditorError = { message: "Failed to insert text", error };
			this.emit("error", editorError);
		}
	}

	/**
	 * Delete text (backspace behavior)
	 */
	deleteText(): void {
		try {
			const selection = this.getSelection();
			this.saveState();

			if (selection) {
				// Delete selection
				this.#state.content =
					this.#state.content.substring(0, selection.start) +
					this.#state.content.substring(selection.end);
				this.#state.cursor = selection.start;
			} else if (this.#state.cursor > 0) {
				// Delete character before cursor
				this.#state.content =
					this.#state.content.substring(0, this.#state.cursor - 1) +
					this.#state.content.substring(this.#state.cursor);
				this.#state.cursor -= 1;
			}

			this.#state.selectionStart = null;
			this.#state.selectionEnd = null;
			this.emit("change", this.#state);
		} catch (error) {
			console.error("Failed to delete text:", error);
			const editorError: EditorError = { message: "Failed to delete text", error };
			this.emit("error", editorError);
		}
	}

	/**
	 * Delete text forward (delete key behavior)
	 */
	deleteTextForward(): void {
		try {
			const selection = this.getSelection();
			this.saveState();

			if (selection) {
				// Delete selection
				this.#state.content =
					this.#state.content.substring(0, selection.start) +
					this.#state.content.substring(selection.end);
				this.#state.cursor = selection.start;
			} else if (this.#state.cursor < this.#state.content.length) {
				// Delete character after cursor
				this.#state.content =
					this.#state.content.substring(0, this.#state.cursor) +
					this.#state.content.substring(this.#state.cursor + 1);
			}

			this.#state.selectionStart = null;
			this.#state.selectionEnd = null;
			this.emit("change", this.#state);
		} catch (error) {
			console.error("Failed to delete text forward:", error);
			const editorError: EditorError = { message: "Failed to delete text", error };
			this.emit("error", editorError);
		}
	}

	/**
	 * Get selected text
	 */
	getSelectedText(): string {
		const selection = this.getSelection();
		if (!selection) {
			return "";
		}
		return this.#state.content.substring(selection.start, selection.end);
	}

	// =============================================================================
	// Undo/Redo System
	// =============================================================================

	/**
	 * Save current state to undo stack
	 */
	saveState(): void {
		this.#undoStack.push({ ...this.#state });
		// Limit stack size
		if (this.#undoStack.length > this.#maxHistorySize) {
			this.#undoStack.shift();
		}
		// Clear redo stack on new action
		this.#redoStack = [];
	}

	/**
	 * Undo last action
	 */
	undo(): void {
		if (this.#undoStack.length > 0) {
			this.#redoStack.push({ ...this.#state });
			this.#state = this.#undoStack.pop()!;
			this.emit("change", this.#state);
			this.emit("undo", this.#state);
		}
	}

	/**
	 * Redo last undone action
	 */
	redo(): void {
		if (this.#redoStack.length > 0) {
			this.#undoStack.push({ ...this.#state });
			this.#state = this.#redoStack.pop()!;
			this.emit("change", this.#state);
			this.emit("redo", this.#state);
		}
	}

	/**
	 * Check if undo is available
	 */
	canUndo(): boolean {
		return this.#undoStack.length > 0;
	}

	/**
	 * Check if redo is available
	 */
	canRedo(): boolean {
		return this.#redoStack.length > 0;
	}

	/**
	 * Clear undo/redo history
	 */
	clearHistory(): void {
		this.#undoStack = [];
		this.#redoStack = [];
	}

	// =============================================================================
	// AI-Assisted Features
	// =============================================================================

	/**
	 * Get smart completion for current context
	 */
	async getSmartCompletion(context: string): Promise<string> {
		if (!this.#aiServiceAvailable || !this.#model) {
			return "";
		}
		try {
			return await generateContent(
				{ content: this.#state.content },
				context,
				this.#model,
				this.getCursorPosition(),
			);
		} catch (error) {
			console.error("Failed to get smart completion:", error);
			const editorError: EditorError = { message: "AI completion failed", error };
			this.emit("error", editorError);
			return "";
		}
	}

	/**
	 * Get context-aware suggestion for current position
	 */
	async getContextAwareSuggestion(context: string): Promise<string> {
		if (!this.#aiServiceAvailable || !this.#model) {
			return "";
		}
		try {
			return await getContextAwareSuggestion(
				{ content: this.#state.content },
				this.#model,
				this.getCursorPosition(),
			);
		} catch (error) {
			console.error("Failed to get context-aware suggestion:", error);
			const editorError: EditorError = { message: "AI suggestion failed", error };
			this.emit("error", editorError);
			return "";
		}
	}

	/**
	 * Auto-format the document using AI
	 */
	async autoFormat(): Promise<void> {
		if (!this.#aiServiceAvailable || !this.#model) {
			return;
		}
		try {
			this.saveState();
			const formatted = await autoFormatDocument(this.#state.content, this.#model);
			this.#state.content = formatted;
			this.emit("change", this.#state);
		} catch (error) {
			console.error("Failed to auto-format content:", error);
			this.#aiServiceAvailable = false;
			const editorError: EditorError = { message: "Auto-formatting failed", error };
			this.emit("error", editorError);
		}
	}

	/**
	 * Analyze the document and get summary/key points
	 */
	async analyzeDocument(): Promise<{
		summary: string;
		keyPoints: string[];
		suggestions: Array<{ range: any; suggestion: string }>;
	}> {
		if (!this.#aiServiceAvailable || !this.#model) {
			return { summary: "", keyPoints: [], suggestions: [] };
		}
		try {
			return await analyzeDocument({ content: this.#state.content }, this.#model);
		} catch (error) {
			console.error("Failed to analyze document:", error);
			const editorError: EditorError = { message: "Document analysis failed", error };
			this.emit("error", editorError);
			return { summary: "", keyPoints: [], suggestions: [] };
		}
	}

	/**
	 * Clear AI response cache
	 */
	clearAICache(): void {
		clearAICache();
	}

	// =============================================================================
	// Syntax Highlighting
	// =============================================================================

	/**
	 * Apply syntax highlighting to markdown content
	 * Returns text with ANSI escape codes for terminal display
	 */
	highlightMarkdown(content: string): string {
		let highlighted = content;

		// Headers (purple/magenta)
		highlighted = highlighted.replace(/^######\s+(.+)$/gm, "\x1b[35m###### $1\x1b[0m");
		highlighted = highlighted.replace(/^#####\s+(.+)$/gm, "\x1b[35m##### $1\x1b[0m");
		highlighted = highlighted.replace(/^####\s+(.+)$/gm, "\x1b[35m#### $1\x1b[0m");
		highlighted = highlighted.replace(/^###\s+(.+)$/gm, "\x1b[35m### $1\x1b[0m");
		highlighted = highlighted.replace(/^##\s+(.+)$/gm, "\x1b[35m## $1\x1b[0m");
		highlighted = highlighted.replace(/^#\s+(.+)$/gm, "\x1b[35m# $1\x1b[0m");

		// Bold (bright)
		highlighted = highlighted.replace(/\*\*(.+?)\*\*/g, "\x1b[1m**$1**\x1b[0m");
		highlighted = highlighted.replace(/__(.+?)__/g, "\x1b[1m__$1__\x1b[0m");

		// Italic
		highlighted = highlighted.replace(/\*(.+?)\*/g, "\x1b[3m$1\x1b[0m");
		highlighted = highlighted.replace(/_(.+?)_/g, "\x1b[3m$1\x1b[0m");

		// Inline code (cyan)
		highlighted = highlighted.replace(/`([^`]+)`/g, "\x1b[36m`$1`\x1b[0m");

		// Code blocks (cyan background simulation with bright)
		highlighted = highlighted.replace(/^```[\s\S]*?^```/gm, (match) => {
			return "\x1b[36m" + match + "\x1b[0m";
		});

		// Links (blue underline)
		highlighted = highlighted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "\x1b[34m[$1]\x1b[0m($2)");

		// Images (blue)
		highlighted = highlighted.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "\x1b[34m![$1]\x1b[0m($2)");

		// Lists (green)
		highlighted = highlighted.replace(/^(\s*[-*+])\s/gm, "\x1b[32m$1\x1b[0m ");
		highlighted = highlighted.replace(/^(\s*\d+\.)\s/gm, "\x1b[32m$1\x1b[0m ");

		// Blockquotes (yellow)
		highlighted = highlighted.replace(/^>\s*/gm, "\x1b[33m> \x1b[0m");

		// Horizontal rules (dim)
		highlighted = highlighted.replace(/^[-*_]{3,}\s*$/gm, "\x1b[2m$&\x1b[0m");

		return highlighted;
	}

	/**
	 * Get highlighted version of current content
	 */
	getHighlightedContent(): string {
		return this.highlightMarkdown(this.#state.content);
	}

	// =============================================================================
	// Keyboard Shortcuts
	// =============================================================================

	/**
	 * Handle keyboard event and return action taken
	 */
	handleKeyDown(event: KeyboardEvent): { action: string; handled: boolean } {
		const ctrl = event.ctrlKey || event.metaKey;
		const shift = event.shiftKey;

		// Ctrl/Cmd + Key shortcuts
		if (ctrl) {
			switch (event.key.toLowerCase()) {
				case "b":
					this.insertText("**bold**");
					event.preventDefault();
					return { action: "insertBold", handled: true };

				case "i":
					this.insertText("*italic*");
					event.preventDefault();
					return { action: "insertItalic", handled: true };

				case "k":
					this.insertText("[link](url)");
					event.preventDefault();
					return { action: "insertLink", handled: true };

				case "s":
					this.emit("saveRequested");
					event.preventDefault();
					return { action: "save", handled: true };

				case "z":
					if (shift) {
						this.redo();
					} else {
						this.undo();
					}
					event.preventDefault();
					return { action: shift ? "redo" : "undo", handled: true };

				case "a":
					this.selectAll();
					event.preventDefault();
					return { action: "selectAll", handled: true };

				case "y":
					this.redo();
					event.preventDefault();
					return { action: "redo", handled: true };

				case "/":
					this.insertText("<!-- comment -->");
					event.preventDefault();
					return { action: "insertComment", handled: true };

				case "e":
					this.autoFormat();
					event.preventDefault();
					return { action: "format", handled: true };
			}
		}

		// Arrow keys for cursor movement
		switch (event.key) {
			case "ArrowLeft":
				this.moveCursor(-1);
				if (shift) {
					// Extend selection
					if (this.#state.selectionEnd === null) {
						this.#state.selectionStart = this.#state.cursor + 1;
						this.#state.selectionEnd = this.#state.cursor;
					} else {
						this.#state.selectionEnd = this.#state.cursor;
					}
				}
				return { action: "moveCursor", handled: true };

			case "ArrowRight":
				this.moveCursor(1);
				if (shift) {
					if (this.#state.selectionEnd === null) {
						this.#state.selectionStart = this.#state.cursor - 1;
						this.#state.selectionEnd = this.#state.cursor;
					} else {
						this.#state.selectionEnd = this.#state.cursor;
					}
				}
				return { action: "moveCursor", handled: true };

			case "ArrowUp":
				this.moveCursorToLineStart();
				return { action: "moveToLineStart", handled: true };

			case "ArrowDown":
				this.moveCursorToLineEnd();
				return { action: "moveToLineEnd", handled: true };

			case "Home":
				this.moveCursorToLineStart();
				this.clearSelection();
				return { action: "moveToLineStart", handled: true };

			case "End":
				this.moveCursorToLineEnd();
				this.clearSelection();
				return { action: "moveToLineEnd", handled: true };
		}

		// Delete key
		if (event.key === "Delete") {
			this.deleteTextForward();
			return { action: "deleteForward", handled: true };
		}

		// Backspace
		if (event.key === "Backspace") {
			this.deleteText();
			return { action: "delete", handled: true };
		}

		return { action: "none", handled: false };
	}

	// =============================================================================
	// Accessibility
	// =============================================================================

	/**
	 * Set aria label for the editor
	 */
	setAriaLabel(label: string): void {
		this.emit("ariaLabel", label);
	}

	/**
	 * Get accessible description of current state
	 */
	getAccessibleDescription(): string {
		const selection = this.getSelection();
		if (selection) {
			const selectedText = this.getSelectedText();
			return `Selected ${selection.end - selection.start} characters: "${selectedText.substring(0, 50)}${selectedText.length > 50 ? "..." : ""}"`;
		}
		return `Cursor at position ${this.#state.cursor} of ${this.#state.content.length} characters`;
	}

	// =============================================================================
	// Performance
	// =============================================================================

	/**
	 * Optimize editor for large files
	 */
	optimizeForLargeFiles(): void {
		// Disable AI features for large files
		if (this.#state.content.length > 10000) {
			this.#aiServiceAvailable = false;
		}
		// Limit history size for large content
		if (this.#state.content.length > 50000) {
			this.#maxHistorySize = 20;
			// Trim history
			while (this.#undoStack.length > this.#maxHistorySize) {
				this.#undoStack.shift();
			}
		}
	}

	// =============================================================================
	// Event System (extends EventEmitter)
	// =============================================================================

	on(event: string, listener: (...args: any[]) => void): this {
		return super.on(event, listener);
	}

	off(event: string, listener: (...args: any[]) => void): this {
		return super.off(event, listener);
	}

	emit(event: string, ...args: any[]): boolean {
		return super.emit(event, ...args);
	}

	// =============================================================================
	// Utility
	// =============================================================================

	/**
	 * Get cursor position as line/character
	 */
	getCursorPosition(): { line: number; character: number } {
		const content = this.#state.content.substring(0, this.#state.cursor);
		const lines = content.split("\n");
		return {
			line: lines.length,
			character: lines[lines.length - 1]?.length ?? 0,
		};
	}

	/**
	 * Get line at given line number
	 */
	getLine(lineNumber: number): string | null {
		const lines = this.#state.content.split("\n");
		if (lineNumber < 1 || lineNumber > lines.length) {
			return null;
		}
		return lines[lineNumber - 1];
	}

	/**
	 * Get total line count
	 */
	getLineCount(): number {
		return this.#state.content.split("\n").length;
	}

	/**
	 * Dispose of editor resources
	 */
	dispose(): void {
		this.removeAllListeners();
		this.#undoStack = [];
		this.#redoStack = [];
		this.clearAICache();
	}
}

// Export types
export type { EditorState, AIAssistant, EditorPlugin, MarkdownEditorOptions, EditorError } from "./types.js";