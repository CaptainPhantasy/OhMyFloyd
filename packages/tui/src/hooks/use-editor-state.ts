'use strict'

import { readFile, writeFile } from 'node:fs/promises'
import { stat } from 'node:fs/promises'

export interface EditorState {
  content: string
  filePath: string
  isDirty: boolean
  isLoading: boolean
  error: Error | null
  recentFiles: string[]
  cursorLine: number
  cursorColumn: number
  selectionStart: { line: number; column: number } | null
  selectionEnd: { line: number; column: number } | null
  undoStack: string[]
  redoStack: string[]
  language: string
}

const MAX_UNDO_STACK = 100
const RECENT_FILES_KEY = 'omf-editor-recent-files'
const MAX_RECENT_FILES = 10

function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    md: 'markdown',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    html: 'html',
    css: 'css',
    scss: 'scss',
    sql: 'sql',
    sh: 'bash',
    bash: 'bash',
  }
  return languageMap[ext] || 'plaintext'
}

/**
 * Editor state manager (non-React version for Node.js/TUI usage)
 */
export class EditorStateManager {
  private _content: string = ''
  private _filePath: string = ''
  private _isDirty: boolean = false
  private _isLoading: boolean = false
  private _error: Error | null = null
  private _recentFiles: string[] = []
  private _cursorLine: number = 0
  private _cursorColumn: number = 0
  private _selectionStart: { line: number; column: number } | null = null
  private _selectionEnd: { line: number; column: number } | null = null
  private _undoStack: string[] = []
  private _redoStack: string[] = []
  private _language: string = 'plaintext'

  private _changeListeners: Set<() => void> = new Set()
  private _isInternalChange: boolean = false

  constructor() {
    this.loadRecentFiles()
  }

  // State getters
  get content(): string { return this._content }
  get filePath(): string { return this._filePath }
  set filePath(value: string) { this._filePath = value }
  get isDirty(): boolean { return this._isDirty }
  get isLoading(): boolean { return this._isLoading }
  get error(): Error | null { return this._error }
  get recentFiles(): string[] { return this._recentFiles }
  get cursorLine(): number { return this._cursorLine }
  get cursorColumn(): number { return this._cursorColumn }
  get selectionStart(): { line: number; column: number } | null { return this._selectionStart }
  get selectionEnd(): { line: number; column: number } | null { return this._selectionEnd }
  get undoStack(): string[] { return this._undoStack }
  get redoStack(): string[] { return this._redoStack }
  get language(): string { return this._language }
  get canUndo(): boolean { return this._undoStack.length > 0 }
  get canRedo(): boolean { return this._redoStack.length > 0 }

  // Subscribe to state changes
  onChange(listener: () => void): () => void {
    this._changeListeners.add(listener)
    return () => this._changeListeners.delete(listener)
  }

  private notifyChange() {
    for (const listener of this._changeListeners) {
      listener()
    }
  }

  // Push to undo stack
  private pushUndo() {
    this._undoStack.push(this._content)
    if (this._undoStack.length > MAX_UNDO_STACK) {
      this._undoStack.shift()
    }
    this._redoStack = []
  }

  // Load recent files from local storage
  private loadRecentFiles() {
    try {
      const savedRecents = localStorage?.getItem(RECENT_FILES_KEY)
      if (savedRecents) {
        this._recentFiles = JSON.parse(savedRecents)
      }
    } catch (err) {
      console.error('Failed to load recent files:', err)
    }
  }

  // Save recent files to local storage
  private saveRecentFiles() {
    try {
      localStorage?.setItem(RECENT_FILES_KEY, JSON.stringify(this._recentFiles))
    } catch (err) {
      console.error('Failed to save recent files:', err)
    }
  }

  // Add to recent files
  addToRecentFiles(path: string) {
    this._recentFiles = this._recentFiles.filter(p => p !== path)
    this._recentFiles = [path, ...this._recentFiles].slice(0, MAX_RECENT_FILES)
    this.saveRecentFiles()
  }

  // Set content with undo tracking
  setContent(newContent: string) {
    if (this._isInternalChange) {
      this._content = newContent
      return
    }
    this.pushUndo()
    this._content = newContent
    this._isDirty = true
    this.notifyChange()
  }

  // Undo
  undo() {
    if (this._undoStack.length === 0) return
    this._redoStack.push(this._content)
    this._content = this._undoStack.pop()!
    this._isInternalChange = true
    this._isDirty = true
    this._isInternalChange = false
    this.notifyChange()
  }

  // Redo
  redo() {
    if (this._redoStack.length === 0) return
    this._undoStack.push(this._content)
    this._content = this._redoStack.pop()!
    this._isInternalChange = true
    this._isDirty = true
    this._isInternalChange = false
    this.notifyChange()
  }

  // Update cursor position
  setCursorPosition(line: number, column: number) {
    this._cursorLine = line
    this._cursorColumn = column
    this.notifyChange()
  }

  // Set selection
  setSelection(start: { line: number; column: number } | null, end: { line: number; column: number } | null) {
    this._selectionStart = start
    this._selectionEnd = end
    this.notifyChange()
  }

  // Clear selection
  clearSelection() {
    this._selectionStart = null
    this._selectionEnd = null
    this.notifyChange()
  }

  // Open file
  async openFile(path: string): Promise<void> {
    this._isLoading = true
    this._error = null
    this.notifyChange()

    try {
      const stats = await stat(path)
      if (!stats.isFile()) {
        throw new Error(`Not a file: ${path}`)
      }
      const fileContent = await readFile(path, 'utf-8')
      this._content = fileContent
      this._filePath = path
      this._isDirty = false
      this._undoStack = []
      this._redoStack = []
      this._language = detectLanguage(path)
      this.addToRecentFiles(path)
      this._cursorLine = 0
      this._cursorColumn = 0
      this.clearSelection()
    } catch (err) {
      this._error = err instanceof Error ? err : new Error(String(err))
      throw this._error
    } finally {
      this._isLoading = false
      this.notifyChange()
    }
  }

  // Save file
  async saveFile(path?: string): Promise<void> {
    const targetPath = path || this._filePath
    if (!targetPath) {
      throw new Error('No file path specified')
    }

    this._isLoading = true
    this._error = null
    this.notifyChange()

    try {
      await writeFile(targetPath, this._content, 'utf-8')
      this._isDirty = false
      if (path) {
        this._filePath = path
        this._language = detectLanguage(path)
        this.addToRecentFiles(path)
      }
    } catch (err) {
      this._error = err instanceof Error ? err : new Error(String(err))
      throw this._error
    } finally {
      this._isLoading = false
      this.notifyChange()
    }
  }

  // Create new file
  newFile(path?: string, initialContent: string = '') {
    this._content = initialContent
    this._filePath = path || ''
    this._isDirty = false
    this._undoStack = []
    this._redoStack = []
    this._language = path ? detectLanguage(path) : 'plaintext'
    this._cursorLine = 0
    this._cursorColumn = 0
    this.clearSelection()
    this.notifyChange()
  }

  // Clear error
  clearError() {
    this._error = null
    this.notifyChange()
  }
}

// React hook version (requires React in scope)
let React: any = null
try {
  React = require('react')
} catch {
  // React not available
}

export function useEditorState() {
  if (!React) {
    throw new Error('React is required for useEditorState hook. Use EditorStateManager for non-React environments.')
  }

  const { useState, useEffect, useCallback, useRef } = React

  const [content, setContentState] = useState('')
  const [filePath, setFilePath] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [recentFiles, setRecentFiles] = useState<string[]>([])
  const [cursorLine, setCursorLine] = useState(0)
  const [cursorColumn, setCursorColumn] = useState(0)
  const [selectionStart, setSelectionStart] = useState<{ line: number; column: number } | null>(null)
  const [selectionEnd, setSelectionEnd] = useState<{ line: number; column: number } | null>(null)
  const [undoStack, setUndoStack] = useState<string[]>([])
  const [redoStack, setRedoStack] = useState<string[]>([])
  const [language, setLanguage] = useState('plaintext')

  const isInternalChange = useRef(false)

  // Load recent files from local storage
  useEffect(() => {
    try {
      const savedRecents = localStorage?.getItem(RECENT_FILES_KEY)
      if (savedRecents) {
        setRecentFiles(JSON.parse(savedRecents))
      }
    } catch (err) {
      // Silently handle localStorage errors
    }
  }, [])

  // Save recent files
  const saveRecentFiles = useCallback((newRecents: string[]) => {
    try {
      localStorage?.setItem(RECENT_FILES_KEY, JSON.stringify(newRecents))
      setRecentFiles(newRecents)
    } catch (err) {
      console.error('Failed to save recent files:', err)
    }
  }, [])

  // Add to recent files
  const addToRecentFiles = useCallback((path: string) => {
    setRecentFiles(prev => {
      const filtered = prev.filter(p => p !== path)
      const updated = [path, ...filtered].slice(0, MAX_RECENT_FILES)
      saveRecentFiles(updated)
      return updated
    })
  }, [saveRecentFiles])

  // Push to undo stack
  const pushUndo = useCallback((newContent: string) => {
    setUndoStack(prev => {
      const stack = [...prev, newContent]
      if (stack.length > MAX_UNDO_STACK) {
        stack.shift()
      }
      return stack
    })
    setRedoStack([])
  }, [])

  // Set content with undo tracking
  const setContent = useCallback((newContent: string) => {
    if (isInternalChange.current) {
      setContentState(newContent)
      return
    }
    pushUndo(content)
    setContentState(newContent)
    setIsDirty(true)
  }, [content, pushUndo])

  // Undo
  const undo = useCallback(() => {
    if (undoStack.length === 0) return
    const previousContent = undoStack[undoStack.length - 1]
    setRedoStack(prev => [...prev, content])
    setUndoStack(prev => prev.slice(0, -1))
    isInternalChange.current = true
    setContentState(previousContent)
    isInternalChange.current = false
  }, [undoStack, content])

  // Redo
  const redo = useCallback(() => {
    if (redoStack.length === 0) return
    const nextContent = redoStack[redoStack.length - 1]
    setUndoStack(prev => [...prev, content])
    setRedoStack(prev => prev.slice(0, -1))
    isInternalChange.current = true
    setContentState(nextContent)
    isInternalChange.current = false
  }, [redoStack, content])

  // Update cursor position
  const setCursorPosition = useCallback((line: number, column: number) => {
    setCursorLine(line)
    setCursorColumn(column)
  }, [])

  // Set selection
  const setSelection = useCallback((start: { line: number; column: number } | null, end: { line: number; column: number } | null) => {
    setSelectionStart(start)
    setSelectionEnd(end)
  }, [])

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectionStart(null)
    setSelectionEnd(null)
  }, [])

  // Open file
  const openFile = useCallback(async (path: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const stats = await stat(path)
      if (!stats.isFile()) {
        throw new Error(`Not a file: ${path}`)
      }
      const fileContent = await readFile(path, 'utf-8')
      setContentState(fileContent)
      setFilePath(path)
      setIsDirty(false)
      setUndoStack([])
      setRedoStack([])
      setLanguage(detectLanguage(path))
      addToRecentFiles(path)
      setCursorLine(0)
      setCursorColumn(0)
      clearSelection()
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      setError(error)
      throw error
    } finally {
      setIsLoading(false)
    }
  }, [addToRecentFiles, clearSelection])

  // Save file
  const saveFile = useCallback(async (path?: string) => {
    const targetPath = path || filePath
    if (!targetPath) {
      throw new Error('No file path specified')
    }
    setIsLoading(true)
    setError(null)
    try {
      await writeFile(targetPath, content, 'utf-8')
      setIsDirty(false)
      if (path) {
        setFilePath(path)
        setLanguage(detectLanguage(path))
        addToRecentFiles(path)
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      setError(error)
      throw error
    } finally {
      setIsLoading(false)
    }
  }, [content, filePath, addToRecentFiles])

  // Create new file
  const newFile = useCallback((path?: string, initialContent: string = '') => {
    setContentState(initialContent)
    setFilePath(path || '')
    setIsDirty(false)
    setUndoStack([])
    setRedoStack([])
    setLanguage(path ? detectLanguage(path) : 'plaintext')
    setCursorLine(0)
    setCursorColumn(0)
    clearSelection()
  }, [clearSelection])

  return {
    // State
    content,
    filePath,
    isDirty,
    isLoading,
    error,
    recentFiles,
    cursorLine,
    cursorColumn,
    selectionStart,
    selectionEnd,
    undoStack,
    redoStack,
    language,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,

    // Content actions
    setContent,
    openFile,
    saveFile,
    newFile,

    // History actions
    undo,
    redo,

    // Cursor actions
    setCursorPosition,
    setSelection,
    clearSelection,

    // Recent files
    addToRecentFiles,

    // Errors
    clearError: () => setError(null),
  }
}
