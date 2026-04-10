'use strict'

// File node type for directory tree
export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink'
  extension?: string
  children?: FileNode[]
  symlinkTarget?: string
  isExpanded?: boolean
}

// Editor state interface
export interface EditorState {
  content: string
  filePath: string
  isDirty: boolean
  isLoading: boolean
  error: Error | null
  cursorLine: number
  cursorColumn: number
  language: string
  recentFiles: string[]
  undoStack: string[]
  redoStack: string[]
}

// Markdown document interface
export interface MarkdownDocument {
  content: string
  filePath?: string
  language?: string
}

// Text range for selections and suggestions
export interface TextRange {
  start: {
    line: number
    character: number
  }
  end: {
    line: number
    character: number
  }
}

// AI response interface
export interface AIResponse {
  generatedContent: string
  summary: string
  keyPoints: string[]
  suggestions: Array<{
    range: TextRange
    suggestion: string
  }>
  changes: Array<{
    range: TextRange
    newText: string
  }>
  issues: Array<{
    range: TextRange
    issue: string
    fix?: string
  }>
}

// AI assistant interface
export interface AIAssistant {
  getSmartCompletion: (context: string) => Promise<string>
  getContextAwareSuggestion: (context: string) => Promise<string>
  autoFormat: (content: string) => Promise<string>
}

// Editor plugin interface
export interface EditorPlugin {
  name: string
  setup: (editor: any) => void
  onContentChange?: (content: string) => void
  onCursorMove?: (line: number, column: number) => void
  onSave?: (content: string) => void
}

// Editor options interface
export interface MarkdownEditorOptions {
  initialContent?: string
  filePath?: string
  aiServiceAvailable?: boolean
  plugins?: EditorPlugin[]
  autoSave?: boolean
  autoSaveInterval?: number
  onSave?: (content: string, filePath: string) => void
  onError?: (error: Error) => void
}

// Editor error interface
export interface EditorError {
  message: string
  error: Error
}

// File operation result
export interface FileOperationResult {
  success: boolean
  error?: Error
  data?: any
}

// Auto-save state
export interface AutoSaveState {
  lastSaved: Date | null
  isSaving: boolean
  error: Error | null
}

// Style issue for linting
export interface StyleIssue {
  line: number
  issue: string
  severity: 'error' | 'warning' | 'info'
}

// Accessibility issue
export interface AccessibilityIssue {
  line: number
  issue: string
  fix: string
  severity: 'error' | 'warning' | 'info'
}

// History entry for undo/redo
export interface HistoryEntry {
  content: string
  timestamp: number
  description: string
}

// Cursor position
export interface CursorPosition {
  line: number
  column: number
}

// Selection range
export interface SelectionRange {
  start: CursorPosition
  end: CursorPosition
}

// Command for editor actions
export interface EditorCommand {
  name: string
  execute: () => void
  canExecute: () => boolean
  description?: string
  shortcut?: string
}
