'use strict'

import React, { useState, useEffect, useCallback, useRef, memo } from 'react'
import { Box, Text } from 'ink'
import { Editor } from '../components/editor'
import { useEditorState } from '../hooks/use-editor-state'
import { useFileOperations } from '../hooks/use-file-operations'
import { useDirectoryTree } from '../hooks/use-directory-tree'
import { FileExplorer } from './file-explorer'
import { FileTypeIcon } from './file-type-icon'
import {
  generateContent,
  analyzeDocument,
  checkStyleConsistency,
  auditAccessibility,
  configureAIService,
  getAIServiceStatus,
} from './ai-assistant'
import { PerformanceMonitor } from '../utils/performance-monitor'

export interface EditorComponentProps {
  initialContent?: string
  initialFilePath?: string
  autoSave?: boolean
  autoSaveInterval?: number
  onSave?: (content: string, filePath: string) => void
  onError?: (error: Error) => void
  className?: string
}

export interface EditorViewState {
  mode: 'edit' | 'preview' | 'split'
  showExplorer: boolean
  showAiPanel: boolean
  showStatusBar: boolean
}

interface StatusInfo {
  line: number
  column: number
  words: number
  chars: number
  language: string
  aiAvailable: boolean
}

/**
 * Main editor component that integrates all editor functionality.
 * Provides a full-featured code/markdown editor with:
 * - Real text editing with cursor movement
 * - File explorer integration
 * - AI-powered suggestions
 * - Undo/redo
 * - Auto-save
 * - Markdown preview
 */
export const EditorComponent = memo(function EditorComponent({
  initialContent = '',
  initialFilePath = '',
  autoSave = false,
  autoSaveInterval = 30000,
  onSave,
  onError,
  className,
}: EditorComponentProps) {
  // Editor state
  const {
    content,
    setContent,
    filePath,
    isDirty,
    isLoading,
    error,
    cursorLine,
    cursorColumn,
    canUndo,
    canRedo,
    undo,
    redo,
    openFile,
    saveFile,
    newFile,
    setCursorPosition,
    language,
  } = useEditorState()

  const { exists, readFile, writeFile } = useFileOperations()
  const { tree, loading: treeLoading, error: treeError, refresh: refreshTree } = useDirectoryTree(
    process.cwd(),
    { maxDepth: 3 },
    []
  )

  // View state
  const [viewState, setViewState] = useState<EditorViewState>({
    mode: 'edit',
    showExplorer: true,
    showAiPanel: false,
    showStatusBar: true,
  })

  // AI state
  const [aiAvailable, setAiAvailable] = useState(false)
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([])
  const [isAiLoading, setIsAiLoading] = useState(false)

  // Status info
  const [statusInfo, setStatusInfo] = useState<StatusInfo>({
    line: 1,
    column: 1,
    words: 0,
    chars: 0,
    language: 'plaintext',
    aiAvailable: false,
  })

  // Auto-save timer
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const perfMonitor = PerformanceMonitor.getInstance()

  // Configure AI service
  useEffect(() => {
    const initAI = async () => {
      // Configure with environment variable if available
      if (process.env.AI_API_KEY) {
        configureAIService({ apiKey: process.env.AI_API_KEY })
      }

      const status = await getAIServiceStatus()
      setAiAvailable(status.available)
      setStatusInfo(prev => ({ ...prev, aiAvailable: status.available }))
    }

    initAI()
  }, [])

  // Calculate status info
  useEffect(() => {
    const text = content || ''
    const words = text.trim() ? text.trim().split(/\s+/).length : 0

    setStatusInfo(prev => ({
      ...prev,
      line: cursorLine + 1,
      column: cursorColumn + 1,
      words,
      chars: text.length,
      language,
      aiAvailable,
    }))
  }, [content, cursorLine, cursorColumn, language, aiAvailable])

  // Auto-save effect
  useEffect(() => {
    if (!autoSave || !isDirty || !filePath) return

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
    }

    autoSaveTimerRef.current = setTimeout(async () => {
      try {
        await saveFile(filePath)
        onSave?.(content, filePath)
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error(String(err)))
      }
    }, autoSaveInterval)

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
      }
    }
  }, [autoSave, autoSaveInterval, isDirty, filePath, content, saveFile, onSave, onError])

  // Load initial content
  useEffect(() => {
    if (initialFilePath) {
      openFile(initialFilePath).catch(err => {
        onError?.(err)
      })
    } else if (initialContent) {
      newFile(initialFilePath || 'untitled.md', initialContent)
    }
  }, [])

  // Handle errors
  useEffect(() => {
    if (error) {
      onError?.(error)
    }
  }, [error, onError])

  // Toggle view modes
  const togglePreview = useCallback(() => {
    setViewState(prev => ({
      ...prev,
      mode: prev.mode === 'preview' ? 'edit' : 'preview',
    }))
  }, [])

  const toggleSplit = useCallback(() => {
    setViewState(prev => ({
      ...prev,
      mode: prev.mode === 'split' ? 'edit' : 'split',
    }))
  }, [])

  const toggleExplorer = useCallback(() => {
    setViewState(prev => ({
      ...prev,
      showExplorer: !prev.showExplorer,
    }))
  }, [])

  const toggleAiPanel = useCallback(() => {
    setViewState(prev => ({
      ...prev,
      showAiPanel: !prev.showAiPanel,
    }))
  }, [])

  // Handle AI suggestions request
  const requestAiSuggestions = useCallback(async () => {
    if (!content || isAiLoading || !aiAvailable) return

    setIsAiLoading(true)
    perfMonitor.startAIResponseMeasurement()

    try {
      const suggestion = await generateContent(
        { content },
        'Suggest improvements for this document',
        undefined,
        1
      )

      if (suggestion) {
        setAiSuggestions(suggestion.split('\n').filter(Boolean).slice(0, 10))
      }
    } catch (err) {
      console.error('AI suggestions failed:', err)
    } finally {
      const responseTime = perfMonitor.endAIResponseMeasurement()
      console.log(`AI suggestions response time: ${responseTime}ms`)
      setIsAiLoading(false)
    }
  }, [content, isAiLoading, aiAvailable])

  // Handle file selection from explorer
  const handleFileSelect = useCallback((path: string) => {
    openFile(path).catch(err => {
      onError?.(err)
    })
  }, [openFile, onError])

  // Handle manual save
  const handleSave = useCallback(async () => {
    if (!filePath) return
    try {
      await saveFile(filePath)
      onSave?.(content, filePath)
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)))
    }
  }, [content, filePath, saveFile, onSave, onError])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey) {
        switch (e.key.toLowerCase()) {
          case 's':
            e.preventDefault()
            handleSave()
            break
          case 'z':
            e.preventDefault()
            undo()
            break
          case 'y':
            e.preventDefault()
            redo()
            break
          case 'b':
            e.preventDefault()
            toggleExplorer()
            break
          case 'p':
            e.preventDefault()
            togglePreview()
            break
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave, undo, redo, toggleExplorer, togglePreview])

  // Render content with line numbers
  const renderContent = () => {
    const lines = (content || '').split('\n')
    return lines.map((line, i) => (
      <Box key={i}>
        <Text dimColor>{String(i + 1).padStart(4, ' ')} │ </Text>
        <Text>{line || ' '}</Text>
      </Box>
    ))
  }

  // Render markdown preview
  const renderPreview = () => {
    const lines = (content || '').split('\n')
    return lines.map((line, i) => {
      // Headings
      if (line.startsWith('# ')) {
        return <Text key={i} bold brightWhite>{line.slice(2)}</Text>
      }
      if (line.startsWith('## ')) {
        return <Text key={i} bold cyan>{line.slice(3)}</Text>
      }
      if (line.startsWith('### ')) {
        return <Text key={i} bold blue>{line.slice(4)}</Text>
      }
      // Bold
      if (line.includes('**')) {
        const parts = line.split('**')
        return (
          <Text key={i}>
            {parts.map((part, idx) =>
              idx % 2 === 1 ? <Text bold key={idx}>{part}</Text> : part
            )}
          </Text>
        )
      }
      // Lists
      if (line.match(/^[-*]\s/)) {
        return (
          <Text key={i}>
            <Text dimColor>• </Text>{line.slice(2)}
          </Text>
        )
      }
      if (line.match(/^\d+\.\s/)) {
        return (
          <Text key={i}>
            <Text dimColor>{line.match(/^\d+/)?.[0]}. </Text>{line.replace(/^\d+\.\s/, '')}
          </Text>
        )
      }
      // Code blocks
      if (line.startsWith('```')) {
        return <Text key={i} dimColor yellow>{line}</Text>
      }
      // Blockquotes
      if (line.startsWith('> ')) {
        return (
          <Text key={i}>
            <Text dimColor>│ </Text><Text italic>{line.slice(2)}</Text>
          </Text>
        )
      }
      // Regular line
      return <Text key={i}>{line || ' '}</Text>
    })
  }

  // Render status bar
  const renderStatusBar = () => (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Text>
        <Text dimColor>Ln {statusInfo.line}, Col {statusInfo.column}</Text>
        <Text dimColor> │ </Text>
        <Text dimColor>{statusInfo.language}</Text>
        <Text dimColor> │ </Text>
        <Text dimColor>{statusInfo.words} words</Text>
        <Text dimColor> │ </Text>
        <Text dimColor>{statusInfo.chars} chars</Text>
        {isDirty && <Text yellow> │ Modified</Text>}
        {statusInfo.aiAvailable && <Text green> │ AI Ready</Text>}
        {!statusInfo.aiAvailable && <Text dimColor> │ AI Offline</Text>}
      </Text>
    </Box>
  )

  // Render AI panel
  const renderAiPanel = () => (
    <Box width="30%" marginLeft={1} flexDirection="column" borderStyle="round" borderColor="green">
      <Box padding={1}>
        <Text bold green>AI Assistant</Text>
      </Box>
      <Box flexGrow={1} padding={1}>
        {isAiLoading ? (
          <Text dimColor>Loading suggestions...</Text>
        ) : aiSuggestions.length > 0 ? (
          aiSuggestions.map((suggestion, i) => (
            <Text key={i} cyan>{suggestion}</Text>
          ))
        ) : (
          <Box flexDirection="column">
            <Text dimColor>No suggestions yet</Text>
            <Text dimColor>Press Ctrl+Shift+A to request</Text>
          </Box>
        )}
      </Box>
    </Box>
  )

  return (
    <Box flexDirection="column" className={className}>
      {/* Toolbar */}
      <Box borderStyle="round" borderColor="blue" padding={1}>
        <Text>
          <Text bold blue>[Editor]</Text>
          <Text dimColor> │ </Text>
          <Text>{filePath || 'untitled.md'}</Text>
          {isDirty && <Text yellow>*</Text>}
          <Text dimColor> │ </Text>
          <Text dimColor onClick={toggleExplorer}>Explorer</Text>
          <Text dimColor> │ </Text>
          <Text dimColor onClick={togglePreview}>Preview</Text>
          <Text dimColor> │ </Text>
          <Text dimColor onClick={toggleSplit}>Split</Text>
          {aiAvailable && (
            <>
              <Text dimColor> │ </Text>
              <Text dimColor onClick={toggleAiPanel}>AI</Text>
            </>
          )}
        </Text>
      </Box>

      {/* Main content area */}
      <Box flexGrow={1} flexDirection="row">
        {/* File explorer */}
        {viewState.showExplorer && (
          <Box width="25%" marginRight={1}>
            <FileExplorer
              rootDir={process.cwd()}
              onFileSelect={handleFileSelect}
              onError={onError}
              activeFile={filePath}
            />
          </Box>
        )}

        {/* Editor area */}
        <Box flexDirection="column" flexGrow={1}>
          {/* Edit mode */}
          {(viewState.mode === 'edit' || viewState.mode === 'split') && (
            <Box
              flexGrow={viewState.mode === 'split' ? 1 : undefined}
              borderStyle="round"
              borderColor="gray"
              padding={1}
              flexDirection="column"
            >
              <Text>{(content || '').split('\n').length > 0 && (
                renderContent()
              )}</Text>
            </Box>
          )}

          {/* Preview mode */}
          {viewState.mode === 'preview' && (
            <Box
              flexGrow={1}
              borderStyle="round"
              borderColor="gray"
              padding={1}
            >
              <Text>{renderPreview()}</Text>
            </Box>
          )}

          {/* Split mode */}
          {viewState.mode === 'split' && (
            <Box
              flexGrow={1}
              borderStyle="round"
              borderColor="blue"
              padding={1}
            >
              <Text>{(content || '').split('\n').length > 0 && (
                renderPreview()
              )}</Text>
            </Box>
          )}
        </Box>

        {/* AI Panel */}
        {viewState.showAiPanel && aiAvailable && renderAiPanel()}
      </Box>

      {/* Status bar */}
      {viewState.showStatusBar && renderStatusBar()}
    </Box>
  )
})

export default EditorComponent
