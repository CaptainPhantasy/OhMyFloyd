// Copyright 2026 OhMyFloyd
// SPDX-License-Identifier: MIT

/**
 * TUI Integration for Markdown Editor and File Explorer
 *
 * Maps editor/explorer events to TUI commands, handles terminal resizing,
 * input modes, and focus management using OMF's TUI system.
 */

import { Box, Text } from 'ink'
import React, { useState, useEffect } from 'react'

// Event types for editor and explorer
interface EditorEvent {
  type: 'EDITOR_OPEN' | 'EDITOR_SAVE' | 'EDITOR_FORMAT' | 'EDITOR_CLOSE'
  payload?: Record<string, unknown>
}

interface ExplorerEvent {
  type: 'EXPLORER_NAVIGATE' | 'EXPLORER_SEARCH' | 'EXPLORER_SELECT'
  payload?: Record<string, unknown>
}

type TUIEvent = EditorEvent | ExplorerEvent

// TUI command types
type TUICommand =
  | 'OPEN_FILE'
  | 'SAVE_FILE'
  | 'FORMAT_FILE'
  | 'CLOSE_FILE'
  | 'NAVIGATE_EXPLORER'
  | 'SEARCH_EXPLORER'
  | 'SELECT_FILE'

// TUI modes
type TUIMode = 'EDITOR' | 'EXPLORER' | 'SPLIT' | 'PREVIEW'

/**
 * TUI Integration - Manages editor/explorer state and TUI rendering
 */
export class TUIIntegration {
  private currentMode: TUIMode = 'EDITOR'
  private currentFocus: 'EDITOR' | 'EXPLORER' = 'EDITOR'
  private eventHandlers: Map<string, (event: TUIEvent) => void> = new Map()
  private terminalWidth: number = 80
  private terminalHeight: number = 24

  constructor() {
    this.setupTerminalResizeHandler()
  }

  /**
   * Set up terminal resize event listener
   */
  private setupTerminalResizeHandler() {
    // Get initial terminal size
    if (typeof process !== 'undefined' && process.stdout) {
      this.terminalWidth = process.stdout.columns || 80
      this.terminalHeight = process.stdout.rows || 24
    }

    // Listen for resize events
    if (typeof process !== 'undefined' && process.stdout) {
      process.stdout.on('resize', () => {
        this.terminalWidth = process.stdout.columns || 80
        this.terminalHeight = process.stdout.rows || 24
        this.handleTerminalResize()
      })
    }
  }

  /**
   * Handle terminal resize
   */
  private handleTerminalResize() {
    console.log(`Terminal resized to ${this.terminalWidth}x${this.terminalHeight}`)
    this.emit('resize', { width: this.terminalWidth, height: this.terminalHeight })
  }

  /**
   * Register event handler
   */
  on(event: string, handler: (event: TUIEvent) => void): void {
    this.eventHandlers.set(event, handler)
  }

  /**
   * Remove event handler
   */
  off(event: string): void {
    this.eventHandlers.delete(event)
  }

  /**
   * Emit event to handlers
   */
  private emit(event: string, data?: unknown): void {
    const handler = this.eventHandlers.get(event)
    if (handler) {
      handler(data as TUIEvent)
    }
  }

  /**
   * Handle incoming TUI event
   */
  handleEvent(event: TUIEvent): void {
    switch (event.type) {
      case 'EDITOR_OPEN':
        this.executeTUICommand('OPEN_FILE', event.payload)
        break
      case 'EDITOR_SAVE':
        this.executeTUICommand('SAVE_FILE', event.payload)
        break
      case 'EDITOR_FORMAT':
        this.executeTUICommand('FORMAT_FILE', event.payload)
        break
      case 'EDITOR_CLOSE':
        this.executeTUICommand('CLOSE_FILE', event.payload)
        break
      case 'EXPLORER_NAVIGATE':
        this.executeTUICommand('NAVIGATE_EXPLORER', event.payload)
        break
      case 'EXPLORER_SEARCH':
        this.executeTUICommand('SEARCH_EXPLORER', event.payload)
        break
      case 'EXPLORER_SELECT':
        this.executeTUICommand('SELECT_FILE', event.payload)
        break
    }
  }

  /**
   * Execute TUI command
   */
  private executeTUICommand(command: TUICommand, payload?: Record<string, unknown>) {
    console.log(`Executing TUI command: ${command}`, payload)
    this.emit(command.toLowerCase().replace('_', ''), payload)
  }

  /**
   * Switch focus between editor and explorer
   */
  switchFocus(to: 'EDITOR' | 'EXPLORER'): void {
    this.currentFocus = to
    console.log(`Focus switched to ${to}`)
    this.emit('focusChange', { focus: to })
  }

  /**
   * Switch TUI mode
   */
  switchMode(mode: TUIMode): void {
    this.currentMode = mode
    console.log(`Mode switched to ${mode}`)
    this.emit('modeChange', { mode })
  }

  /**
   * Get current mode
   */
  getMode(): TUIMode {
    return this.currentMode
  }

  /**
   * Get current focus
   */
  getFocus(): 'EDITOR' | 'EXPLORER' {
    return this.currentFocus
  }

  /**
   * Get terminal dimensions
   */
  getTerminalSize(): { width: number; height: number } {
    return { width: this.terminalWidth, height: this.terminalHeight }
  }

  /**
   * Calculate split layout based on terminal size
   */
  calculateSplitLayout(explorerWidthPercent: number = 25): {
    explorerWidth: number
    editorWidth: number
  } {
    const minExplorerWidth = 20
    const minEditorWidth = 40

    const explorerWidth = Math.max(
      minExplorerWidth,
      Math.floor(this.terminalWidth * (explorerWidthPercent / 100))
    )
    const editorWidth = Math.max(
      minEditorWidth,
      this.terminalWidth - explorerWidth - 1 // 1 for divider
    )

    return { explorerWidth, editorWidth }
  }

  /**
   * Dispatch event from editor
   */
  dispatchEditorEvent(type: EditorEvent['type'], payload?: Record<string, unknown>): void {
    this.handleEvent({ type, payload })
  }

  /**
   * Dispatch event from explorer
   */
  dispatchExplorerEvent(type: ExplorerEvent['type'], payload?: Record<string, unknown>): void {
    this.handleEvent({ type, payload })
  }
}

// React component interface
interface TUIRendererProps {
  mode: TUIMode
  focus: 'EDITOR' | 'EXPLORER'
  explorerWidth: number
  explorerContent: React.ReactNode
  editorContent: React.ReactNode
}

/**
 * Render the TUI layout based on mode and focus
 */
export function TUIRenderer({ mode, focus, explorerWidth, explorerContent, editorContent }: TUIRendererProps): React.ReactElement {
  const [width, setWidth] = useState(80)

  useEffect(() => {
    // Get terminal width
    if (typeof process !== 'undefined' && process.stdout) {
      setWidth(process.stdout.columns || 80)
    }
  }, [])

  // Explorer-only mode
  if (mode === 'EXPLORER') {
    return (
      <Box width={width}>
        {explorerContent}
      </Box>
    )
  }

  // Editor-only mode
  if (mode === 'EDITOR') {
    return (
      <Box width={width}>
        {editorContent}
      </Box>
    )
  }

  // Split mode
  return (
    <Box width={width} flexDirection="row">
      <Box width={explorerWidth}>
        {explorerContent}
      </Box>
      <Box borderStyle="single" borderDim={false}>
        <Text>|</Text>
      </Box>
      <Box flexGrow={1}>
        {editorContent}
      </Box>
    </Box>
  )
}

/**
 * Status bar component
 */
interface StatusBarProps {
  mode: TUIMode
  focus: 'EDITOR' | 'EXPLORER'
  filePath?: string
  isDirty?: boolean
  cursorPosition?: { line: number; character: number }
}

export function StatusBar({ mode, focus, filePath, isDirty, cursorPosition }: StatusBarProps): React.ReactElement {
  const modeLabel = mode === 'SPLIT' ? 'SPLIT' : mode
  const focusLabel = focus

  return (
    <Box flexDirection="row" borderStyle="single" paddingX={1}>
      <Text color="cyan">[{modeLabel}]</Text>
      <Text color="gray"> | </Text>
      <Text color="blue">[{focusLabel}]</Text>
      {filePath && (
        <>
          <Text color="gray"> | </Text>
          <Text color={isDirty ? 'yellow' : 'white'}>{filePath}{isDirty ? ' *' : ''}</Text>
        </>
      )}
      {cursorPosition && (
        <>
          <Text color="gray"> | </Text>
          <Text color="gray">Ln {cursorPosition.line}, Col {cursorPosition.character}</Text>
        </>
      )}
    </Box>
  )
}

// Export singleton instance for non-React usage
let integrationInstance: TUIIntegration | null = null

export function getTUIIntegration(): TUIIntegration {
  if (!integrationInstance) {
    integrationInstance = new TUIIntegration()
  }
  return integrationInstance
}

// Export types
export type { EditorEvent, ExplorerEvent, TUIEvent, TUICommand, TUIMode }