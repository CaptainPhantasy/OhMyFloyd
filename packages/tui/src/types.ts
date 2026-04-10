'use strict'

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink'
  extension?: string
  children?: FileNode[]
}

export interface EditorState {
  content: string
  filePath: string
  isDirty: boolean
  recentFiles: string[]
}

export interface FileOperationResult {
  success: boolean
  error?: Error
}