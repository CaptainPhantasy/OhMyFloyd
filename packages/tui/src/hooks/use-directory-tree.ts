'use strict'

import { useState, useEffect, useCallback, useRef } from 'react'
import { readdir, lstat, stat, watch } from 'node:fs/promises'
import { join, basename, extname } from 'node:path'

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink'
  extension?: string
  size?: number
  children?: FileNode[]
  symlinkTarget?: string
}

export interface DirectoryTreeOptions {
  maxDepth?: number
  includeHidden?: boolean
  filter?: (node: FileNode) => boolean
  sortOrder?: 'name' | 'type' | 'size' | 'modified'
  sortDirection?: 'asc' | 'desc'
}

interface WatcherHandle {
  close(): void
}

const DEFAULT_OPTIONS: Required<DirectoryTreeOptions> = {
  maxDepth: 3,
  includeHidden: false,
  filter: () => true,
  sortOrder: 'name',
  sortDirection: 'asc',
}

/**
 * Hook for loading and managing a directory tree with file watching.
 */
export function useDirectoryTree(
  rootDir: string,
  options: DirectoryTreeOptions = {},
  deps: unknown[] = []
) {
  const { maxDepth, includeHidden, filter, sortOrder, sortDirection } = {
    ...DEFAULT_OPTIONS,
    ...options,
  }

  const [tree, setTree] = useState<FileNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [lastRefresh, setLastRefresh] = useState(Date.now())

  const watchersRef = useRef<Map<string, WatcherHandle>>(new Map())
  const abortControllerRef = useRef<AbortController | null>(null)

  // Clean up watchers on unmount or rootDir change
  useEffect(() => {
    // Close existing watchers
    for (const watcher of watchersRef.current.values()) {
      try {
        watcher.close()
      } catch {
        // Ignore close errors
      }
    }
    watchersRef.current.clear()

    // Abort any pending operations
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()

    return () => {
      for (const watcher of watchersRef.current.values()) {
        try {
          watcher.close()
        } catch {
          // Ignore close errors
        }
      }
      watchersRef.current.clear()
      abortControllerRef.current?.abort()
    }
  }, [rootDir])

  // Sort nodes based on options
  const sortNodes = useCallback((nodes: FileNode[]): FileNode[] => {
    const sorted = [...nodes].sort((a, b) => {
      // Directories always come first
      if (a.type === 'directory' && b.type !== 'directory') return -1
      if (a.type !== 'directory' && b.type === 'directory') return 1

      let comparison = 0
      switch (sortOrder) {
        case 'name':
          comparison = a.name.localeCompare(b.name)
          break
        case 'type':
          comparison = a.type.localeCompare(b.type)
          break
        case 'size':
          comparison = (a.size || 0) - (b.size || 0)
          break
        case 'modified':
          // Modified time would need to be fetched separately
          comparison = 0
          break
      }

      return sortDirection === 'asc' ? comparison : -comparison
    })

    return sorted
  }, [sortOrder, sortDirection])

  // Build a single node
  const buildNode = useCallback(async (dirPath: string, name: string, currentDepth: number): Promise<FileNode | null> => {
    const fullPath = join(dirPath, name)

    // Skip hidden files if not included
    if (!includeHidden && name.startsWith('.')) {
      return null
    }

    try {
      const fileStat = await lstat(fullPath)

      if (fileStat.isSymbolicLink()) {
        try {
          const realStat = await stat(fullPath)
          return {
            name,
            path: fullPath,
            type: realStat.isDirectory() ? 'symlink' : 'file',
            extension: extname(name) || undefined,
            size: realStat.size,
            symlinkTarget: fileStat.isDirectory()
              ? join(fullPath, '..')
              : undefined,
          }
        } catch {
          // Broken symlink
          return {
            name: `${name} ⤫`,
            path: fullPath,
            type: 'file',
            extension: extname(name) || undefined,
          }
        }
      }

      if (fileStat.isDirectory()) {
        let children: FileNode[] = []

        // Only populate children if within depth limit
        if (currentDepth < maxDepth) {
          try {
            const entries = await readdir(fullPath)
            children = await Promise.all(
              entries
                .filter(entry => includeHidden || !entry.startsWith('.'))
                .map(entry => buildNode(fullPath, entry, currentDepth + 1))
            )
            children = children.filter((node): node is FileNode => node !== null)
            children = sortNodes(children)
          } catch {
            // Permission denied - return empty children
            children = []
          }
        }

        return {
          name,
          path: fullPath,
          type: 'directory',
          children,
        }
      }

      // Regular file
      return {
        name,
        path: fullPath,
        type: 'file',
        extension: extname(name) || undefined,
        size: fileStat.size,
      }
    } catch (err) {
      // Permission denied or other error
      console.error(`Error building node for ${fullPath}:`, err)
      return null
    }
  }, [includeHidden, maxDepth, sortNodes])

  // Build the full tree
  const buildTree = useCallback(async (): Promise<FileNode[]> => {
    try {
      const entries = await readdir(rootDir)
      const nodes = await Promise.all(
        entries
          .filter(name => includeHidden || !name.startsWith('.'))
          .map(name => buildNode(rootDir, name, 1))
      )

      const filteredNodes = nodes
        .filter((node): node is FileNode => node !== null)
        .filter(filter)

      return sortNodes(filteredNodes)
    } catch (err) {
      throw new Error(
        `Failed to read directory ${rootDir}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }, [rootDir, includeHidden, buildNode, filter, sortNodes])

  // Refresh the tree
  const refresh = useCallback(async () => {
    if (abortControllerRef.current?.signal.aborted) {
      return
    }

    try {
      setLoading(true)
      setError(null)
      const newTree = await buildTree()
      if (!abortControllerRef.current?.signal.aborted) {
        setTree(newTree)
        setLastRefresh(Date.now())
      }
    } catch (err) {
      if (!abortControllerRef.current?.signal.aborted) {
        setError(err as Error)
      }
    } finally {
      if (!abortControllerRef.current?.signal.aborted) {
        setLoading(false)
      }
    }
  }, [buildTree])

  // Load tree on mount and when dependencies change
  useEffect(() => {
    refresh()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootDir, ...deps])

  // Watch a specific directory for changes
  const watchDirectory = useCallback(async (
    dirPath: string,
    callback: (event: 'change' | 'rename', filename: string | null) => void
  ): Promise<() => void> => {
    try {
      const watcher = await watch(dirPath, { recursive: true }, (event, filename) => {
        callback(event as 'change' | 'rename', filename)
      })

      const handle = {
        close: () => {
          try {
            watcher.close()
          } catch {
            // Ignore close errors
          }
        },
      }

      watchersRef.current.set(dirPath, handle)

      return () => {
        handle.close()
        watchersRef.current.delete(dirPath)
      }
    } catch (err) {
      console.error(`Failed to watch directory ${dirPath}:`, err)
      return () => {}
    }
  }, [])

  // Find a node by path
  const findNode = useCallback((path: string, nodes: FileNode[] = tree): FileNode | null => {
    for (const node of nodes) {
      if (node.path === path) {
        return node
      }
      if (node.children) {
        const found = findNode(path, node.children)
        if (found) {
          return found
        }
      }
    }
    return null
  }, [tree])

  // Get parent directory path
  const getParentPath = useCallback((path: string): string => {
    const parts = path.split('/')
    parts.pop()
    return parts.join('/') || '/'
  }, [])

  // Expand/collapse state helpers
  const getAllDescendantPaths = useCallback((node: FileNode): string[] => {
    const paths: string[] = [node.path]
    if (node.children) {
      for (const child of node.children) {
        paths.push(...getAllDescendantPaths(child))
      }
    }
    return paths
  }, [])

  return {
    tree,
    loading,
    error,
    lastRefresh,
    refresh,

    // Watch functionality
    watchDirectory,

    // Query helpers
    findNode,
    getParentPath,
    getAllDescendantPaths,
  }
}
