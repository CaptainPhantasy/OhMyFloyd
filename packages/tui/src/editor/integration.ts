'use strict'

// Editor Integration - Provides a unified interface for editor and file explorer
// This module coordinates between the editor state, file operations, and UI components

import { EditorStateManager } from '../hooks/use-editor-state'
import { FileOperations } from '../hooks/use-file-operations'

interface EditorIntegrationState {
  showExplorer: boolean
  explorerWidth: number
  activeView: 'editor' | 'preview' | 'split'
}

interface EditorIntegrationCallbacks {
  onError: (error: Error) => void
  onSave?: (content: string, path: string) => void
  onFileSelect?: (path: string) => void
}

/**
 * Creates an editor integration object that coordinates editor and explorer
 */
export function createEditorIntegration(
  rootDir: string,
  callbacks: EditorIntegrationCallbacks
) {
  const { onError } = callbacks

  // Initialize state
  let state: EditorIntegrationState = {
    showExplorer: true,
    explorerWidth: 25,
    activeView: 'editor',
  }

  // File operations
  const fileOps = new FileOperations()

  // Editor state
  const editorState = new EditorStateManager()

  // Handle file selection from explorer
  const handleFileSelect = async (path: string) => {
    try {
      const result = await fileOps.readFile(path)
      if (result.success && result.data !== undefined) {
        editorState.setContent(result.data)
        editorState._filePath = path
        callbacks.onFileSelect?.(path)
      } else if (result.error) {
        onError(result.error)
      }
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  // Handle file save
  const handleSave = async () => {
    const path = editorState.filePath
    if (!path) return

    try {
      const result = await fileOps.writeFile(path, editorState.content)
      if (!result.success && result.error) {
        onError(result.error)
      } else {
        await editorState.saveFile(path)
        callbacks.onSave?.(editorState.content, path)
      }
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  // Handle file creation
  const handleCreateFile = async (path: string) => {
    try {
      const result = await fileOps.writeFile(path, '')
      if (result.success) {
        editorState.newFile(path, '')
        callbacks.onFileSelect?.(path)
      } else if (result.error) {
        onError(result.error)
      }
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  // Handle file rename
  const handleRenameFile = async (oldPath: string, newPath: string) => {
    try {
      const result = await fileOps.renameFile(oldPath, newPath)
      if (result.success) {
        if (editorState.filePath === oldPath) {
          editorState._filePath = newPath
        }
      } else if (result.error) {
        onError(result.error)
      }
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  // Handle file deletion
  const handleDeleteFile = async (path: string) => {
    try {
      const result = await fileOps.deleteFile(path)
      if (result.success) {
        if (editorState.filePath === path) {
          editorState.setContent('')
          editorState._filePath = ''
        }
      } else if (result.error) {
        onError(result.error)
      }
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  // Toggle explorer visibility
  const toggleExplorer = () => {
    state.showExplorer = !state.showExplorer
  }

  // Adjust explorer width
  const adjustExplorerWidth = (delta: number) => {
    state.explorerWidth = Math.max(10, Math.min(50, state.explorerWidth + delta))
  }

  // Set active view
  const setActiveView = (view: 'editor' | 'preview' | 'split') => {
    state.activeView = view
  }

  return {
    // State getters
    get showExplorer() { return state.showExplorer },
    get explorerWidth() { return state.explorerWidth },
    get activeView() { return state.activeView },

    // File handlers
    handleFileSelect,
    handleSave,
    handleCreateFile,
    handleRenameFile,
    handleDeleteFile,

    // View controls
    toggleExplorer,
    adjustExplorerWidth,
    setActiveView,

    // Editor state (for direct access if needed)
    editor: {
      get content() { return editorState.content },
      get filePath() { return editorState.filePath },
      get isDirty() { return editorState.isDirty },
      setContent: editorState.setContent.bind(editorState),
      openFile: editorState.openFile.bind(editorState),
      saveFile: editorState.saveFile.bind(editorState),
      newFile: editorState.newFile.bind(editorState),
    },
  }
}

// Re-export the EditorIntegration class for backward compatibility
export class EditorIntegration {
  private integration: ReturnType<typeof createEditorIntegration>

  constructor(props: { rootDir: string; onError: (error: Error) => void; initialFile?: string }) {
    this.integration = createEditorIntegration(props.rootDir, {
      onError: props.onError,
    })
  }

  get showExplorer() {
    return this.integration.showExplorer
  }

  get explorerWidth() {
    return this.integration.explorerWidth
  }

  toggleExplorer() {
    this.integration.toggleExplorer()
  }

  adjustExplorerWidth(delta: number) {
    this.integration.adjustExplorerWidth(delta)
  }
}
