'use strict'

import { Box, Text, useApp, useInput } from 'ink'
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { FileTypeIcon } from './file-type-icon'

interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink'
  extension?: string
  children?: FileNode[]
  size?: number
  modified?: Date
}

interface FileExplorerProps {
  rootDir: string
  onFileSelect: (path: string) => void
  onError: (error: Error) => void
  activeFile?: string
}

/**
 * Build directory tree recursively with depth limit
 */
async function buildDirectoryTree(
  dirPath: string,
  maxDepth: number = 3,
  currentDepth: number = 0
): Promise<FileNode[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    const nodes: FileNode[] = []

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      
      try {
        const stat = await fs.stat(fullPath)

        if (entry.isDirectory()) {
          // Skip hidden directories and common ignored directories
          if (entry.name.startsWith('.') || 
              entry.name === 'node_modules' || 
              entry.name === '__pycache__' ||
              entry.name === 'dist' ||
              entry.name === 'build' ||
              entry.name === '.git') {
            nodes.push({
              name: entry.name + '/',
              path: fullPath,
              type: 'directory',
              children: []
            })
          } else {
            // Recursively load children for directories within depth limit
            const children = currentDepth < maxDepth - 1
              ? await buildDirectoryTree(fullPath, maxDepth, currentDepth + 1)
              : []

            nodes.push({
              name: entry.name + '/',
              path: fullPath,
              type: 'directory',
              children,
              size: stat.size,
              modified: stat.mtime
            })
          }
        } else if (entry.isSymbolicLink()) {
          // Check if symlink target is accessible
          try {
            const targetStat = await fs.stat(fullPath)
            nodes.push({
              name: entry.name + ' ->',
              path: fullPath,
              type: targetStat.isDirectory() ? 'symlink' : 'file',
              extension: path.extname(entry.name) || undefined
            })
          } catch {
            // Broken symlink
            nodes.push({
              name: entry.name + ' x',
              path: fullPath,
              type: 'file'
            })
          }
        } else {
          nodes.push({
            name: entry.name,
            path: fullPath,
            type: 'file',
            extension: path.extname(entry.name) || undefined,
            size: stat.size,
            modified: stat.mtime
          })
        }
      } catch (err) {
        // Skip files/directories we can't access
        console.warn(`Cannot access ${fullPath}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // Sort: directories first, then files, alphabetically
    return nodes.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1
      if (a.type !== 'directory' && b.type === 'directory') return 1
      return a.name.localeCompare(b.name)
    })
  } catch (err) {
    throw new Error(`Failed to read directory ${dirPath}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Search files matching query in directory tree
 */
function searchTree(nodes: FileNode[], query: string, caseSensitive: boolean = false): FileNode[] {
  const results: FileNode[] = []
  const searchTerm = caseSensitive ? query : query.toLowerCase()

  function search(nodeList: FileNode[]) {
    for (const node of nodeList) {
      const nameMatches = caseSensitive
        ? node.name.includes(searchTerm)
        : node.name.toLowerCase().includes(searchTerm)

      if (nameMatches) {
        results.push(node)
      }

      // Search children recursively
      if (node.children && node.children.length > 0) {
        search(node.children)
      }
    }
  }

  search(nodes)
  return results
}

export const FileExplorer = ({ rootDir, onFileSelect, onError, activeFile }: FileExplorerProps) => {
  const { exit } = useApp()
  const [tree, setTree] = useState<FileNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedPath, setSelectedPath] = useState('')
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [favorites, setFavorites] = useState<string[]>([])
  const [recentFiles, setRecentFiles] = useState<string[]>([])
  const [cursorIndex, setCursorIndex] = useState(0)
  const [searchMode, setSearchMode] = useState(false)

  // Load directory tree
  useEffect(() => {
    const loadTree = async () => {
      try {
        setLoading(true)
        setError(null)
        
        const nodes = await buildDirectoryTree(rootDir, 3)
        setTree(nodes)
        
        // Auto-expand root directory
        setExpandedDirs(new Set([rootDir]))
        setLoading(false)
      } catch (err) {
        setError(err as Error)
        setLoading(false)
        onError(err as Error)
      }
    }

    loadTree()
  }, [rootDir, onError])

  // Load favorites and recent files from storage (using a simple file-based approach)
  useEffect(() => {
    const loadState = async () => {
      try {
        const statePath = path.join(rootDir, '.omf-explorer-state.json')
        const content = await fs.readFile(statePath, 'utf-8').catch(() => '{}')
        const state = JSON.parse(content)
        if (state.favorites) setFavorites(state.favorites)
        if (state.recents) setRecentFiles(state.recents)
      } catch {
        // Silently handle errors
      }
    }
    loadState()
  }, [rootDir])

  // Save state when favorites or recent files change
  useEffect(() => {
    const saveState = async () => {
      try {
        const statePath = path.join(rootDir, '.omf-explorer-state.json')
        await fs.writeFile(statePath, JSON.stringify({ favorites, recents: recentFiles }), 'utf-8')
      } catch {
        // Silently handle errors
      }
    }
    saveState()
  }, [favorites, recentFiles, rootDir])

  // Get flat list of visible nodes (for navigation)
  const visibleNodes = useMemo(() => {
    if (searchTerm) {
      return searchTree(tree, searchTerm)
    }

    const result: FileNode[] = []
    
    function flatten(nodes: FileNode[], depth: number = 0) {
      for (const node of nodes) {
        result.push({ ...node, name: '  '.repeat(depth) + node.name })
        
        if (node.type === 'directory' && expandedDirs.has(node.path)) {
          if (node.children) {
            flatten(node.children, depth + 1)
          }
        }
      }
    }
    
    flatten(tree)
    return result
  }, [tree, searchTerm, expandedDirs])

  // Toggle directory expansion
  const toggleDir = useCallback((dirPath: string) => {
    setExpandedDirs(prev => {
      const newSet = new Set(prev)
      if (newSet.has(dirPath)) {
        newSet.delete(dirPath)
      } else {
        newSet.add(dirPath)
      }
      return newSet
    })
  }, [])

  // Handle file/directory selection
  const handleSelect = useCallback((node: FileNode) => {
    setSelectedPath(node.path)
    setCursorIndex(visibleNodes.findIndex(n => n.path === node.path))
    
    // Add to recent files
    if (node.type === 'file') {
      setRecentFiles(prev => {
        const newRecents = prev.filter(p => p !== node.path)
        return [node.path, ...newRecents].slice(0, 10)
      })
    }
    
    onFileSelect(node.path)
  }, [visibleNodes, onFileSelect])

  // Toggle favorite status
  const toggleFavorite = useCallback((filePath: string) => {
    setFavorites(prev => {
      const newFavorites = prev.includes(filePath)
        ? prev.filter(p => p !== filePath)
        : [...prev, filePath]
      return newFavorites
    })
  }, [])

  // Handle keyboard input
  useInput((input, key) => {
    if (searchMode) {
      if (key.escape) {
        setSearchMode(false)
        setSearchTerm('')
      } else if (key.backspace || key.delete) {
        setSearchTerm(prev => prev.slice(0, -1))
      } else if (key.return) {
        // Select first match
        if (visibleNodes.length > 0) {
          handleSelect(visibleNodes[0])
        }
        setSearchMode(false)
      } else if (input && input.length === 1) {
        setSearchTerm(prev => prev + input)
      }
      return
    }

    if (key.upArrow) {
      setCursorIndex(prev => Math.max(0, prev - 1))
      return
    }
    
    if (key.downArrow) {
      setCursorIndex(prev => Math.min(visibleNodes.length - 1, prev + 1))
      return
    }
    
    if (key.return) {
      const node = visibleNodes[cursorIndex]
      if (node) {
        if (node.type === 'directory') {
          toggleDir(node.path)
        } else {
          handleSelect(node)
        }
      }
      return
    }
    
    if (key.leftArrow) {
      const node = visibleNodes[cursorIndex]
      if (node && node.type === 'directory' && expandedDirs.has(node.path)) {
        toggleDir(node.path)
      }
      return
    }
    
    if (key.rightArrow) {
      const node = visibleNodes[cursorIndex]
      if (node && node.type === 'directory' && !expandedDirs.has(node.path)) {
        toggleDir(node.path)
      }
      return
    }

    // Enter search mode with /
    if (input === '/') {
      setSearchMode(true)
      setSearchTerm('')
      return
    }

    // Toggle favorite with 'f'
    if (input === 'f' && selectedPath) {
      toggleFavorite(selectedPath)
      return
    }
  })

  // Render favorites section
  const renderFavorites = () => {
    if (favorites.length === 0) return null
    
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="yellow">Favorites</Text>
        {favorites.map(favPath => (
          <Box key={favPath}>
            <Text color="cyan">
              <FileTypeIcon path={favPath} /> {path.basename(favPath)}
            </Text>
          </Box>
        ))}
      </Box>
    )
  }

  // Render recent files section
  const renderRecents = () => {
    if (recentFiles.length === 0) return null
    
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="blue">Recent</Text>
        {recentFiles.map(recPath => (
          <Box key={recPath}>
            <Text color="cyan">
              <FileTypeIcon path={recPath} /> {path.basename(recPath)}
            </Text>
          </Box>
        ))}
      </Box>
    )
  }

  // Render single file/directory node
  const renderNode = (node: FileNode, index: number) => {
    const isActive = activeFile === node.path
    const isSelected = selectedPath === node.path
    const isCursor = index === cursorIndex
    const isFavorite = favorites.includes(node.path)
    const isExpanded = node.type === 'directory' && expandedDirs.has(node.path)
    
    // Remove leading spaces from name for display
    const displayName = node.name.trimStart()
    
    return (
      <Box 
        key={node.path} 
        paddingLeft={1}
        backgroundColor={isCursor ? 'blue' : undefined}
      >
        <Text>
          {node.type === 'directory' && (
            isExpanded ? '[D] ' : '[>] '
          )}
          {isCursor && '>> '}
          <FileTypeIcon path={node.path} />
          {isFavorite && ' *'}
          {isActive ? (
            <Text color="green" bold>{displayName}</Text>
          ) : isSelected ? (
            <Text color="blue" bold>{displayName}</Text>
          ) : (
            <Text>{displayName}</Text>
          )}
          {node.size !== undefined && node.type === 'file' && (
            <Text color="gray"> ({formatSize(node.size)})</Text>
          )}
        </Text>
      </Box>
    )
  }

  // Render file list
  const renderFileList = () => {
    if (visibleNodes.length === 0) {
      return <Text color="gray">No files found</Text>
    }

    // Limit visible items to prevent overwhelming the terminal
    const maxVisible = 50
    const startIndex = Math.max(0, cursorIndex - 10)
    const endIndex = Math.min(visibleNodes.length, startIndex + maxVisible)
    const visibleSlice = visibleNodes.slice(startIndex, endIndex)

    return visibleSlice.map((node, idx) => renderNode(node, startIndex + idx))
  }

  // Loading state
  if (loading) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan">Loading directory...</Text>
        <Box marginTop={1}>
          <Text color="gray">{rootDir}</Text>
        </Box>
      </Box>
    )
  }

  // Error state
  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">Error loading directory</Text>
        <Text color="red">{error.message}</Text>
      </Box>
    )
  }

  // Search mode UI
  if (searchMode) {
    return (
      <Box flexDirection="column" height="100%">
        <Box borderStyle="round" borderColor="cyan" padding={1}>
          <Text color="cyan">Search: </Text>
          <Text underline>{searchTerm}</Text>
          <Text color="gray"> (ESC to cancel)</Text>
        </Box>
        <Box flexDirection="column" overflow="hidden">
          {renderFileList()}
        </Box>
      </Box>
    )
  }

  // Normal view
  return (
    <Box flexDirection="column" height="100%">
      <Box borderStyle="round" borderColor="gray" padding={1} marginBottom={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold>File Explorer</Text>
          <Text color="gray">/ {rootDir}</Text>
        </Box>
      </Box>
      
      <Box marginBottom={1}>
        <Text color="gray">Search: /{searchTerm || '...'}</Text>
      </Box>
      
      {renderFavorites()}
      {renderRecents()}
      
      <Box flexGrow={1} overflow="hidden" flexDirection="column">
        {renderFileList()}
        {visibleNodes.length > 50 && (
          <Text color="gray" marginTop={1}>
            ... and {visibleNodes.length - 50} more items
          </Text>
        )}
      </Box>

      <Box borderStyle="single" marginTop={1} paddingTop={1}>
        <Text color="gray">
          Arrow keys: Navigate | Enter: Open/Select | /: Search | f: Favorite
        </Text>
      </Box>
    </Box>
  )
}

/**
 * Format file size for display
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`
}