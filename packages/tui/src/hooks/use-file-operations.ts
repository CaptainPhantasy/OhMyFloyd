'use strict'

import { readFile, writeFile, unlink, rename, copyFile } from 'node:fs/promises'
import { stat, lstat, readdir, access, constants } from 'node:fs/promises'
import { dirname, basename, extname, join } from 'node:path'
import { mkdir } from 'node:fs/promises'

export interface FileOperationError extends Error {
  code?: string
  path?: string
}

export interface FileStats {
  size: number
  isFile: boolean
  isDirectory: boolean
  isSymbolicLink: boolean
  created: Date
  modified: Date
  accessed: Date
  permissions: string
}

export interface FileOperationResult<T = void> {
  success: boolean
  data?: T
  error?: FileOperationError
}

export interface WatchCallback {
  (event: 'change' | 'rename', filename: string | null): void
}

export interface Watcher {
  close(): void
}

/**
 * File operations utility functions for Node.js environments
 * These functions work without React and are suitable for TUI/CLI usage
 */

// Check if file/directory exists
export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

// Read file content
export async function readFileContent(path: string): Promise<FileOperationResult<string>> {
  try {
    const content = await readFile(path, 'utf-8')
    return { success: true, data: content }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err)) as FileOperationError
    error.code = 'READ_ERROR'
    error.path = path
    return { success: false, error }
  }
}

// Write file content
export async function writeFileContent(path: string, content: string): Promise<FileOperationResult> {
  try {
    const dir = dirname(path)
    await mkdir(dir, { recursive: true })
    await writeFile(path, content, 'utf-8')
    return { success: true }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err)) as FileOperationError
    error.code = 'WRITE_ERROR'
    error.path = path
    return { success: false, error }
  }
}

// Read binary file
export async function readBinaryFileContent(path: string): Promise<FileOperationResult<Buffer>> {
  try {
    const content = await readFile(path)
    return { success: true, data: content }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err)) as FileOperationError
    error.code = 'READ_ERROR'
    error.path = path
    return { success: false, error }
  }
}

// Write binary file
export async function writeBinaryFileContent(path: string, content: Buffer): Promise<FileOperationResult> {
  try {
    const dir = dirname(path)
    await mkdir(dir, { recursive: true })
    await writeFile(path, content)
    return { success: true }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err)) as FileOperationError
    error.code = 'WRITE_ERROR'
    error.path = path
    return { success: false, error }
  }
}

// Delete file
export async function deleteFileContent(path: string): Promise<FileOperationResult> {
  try {
    await unlink(path)
    return { success: true }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err)) as FileOperationError
    error.code = 'DELETE_ERROR'
    error.path = path
    return { success: false, error }
  }
}

// Rename/move file
export async function renameFileContent(oldPath: string, newPath: string): Promise<FileOperationResult> {
  try {
    const newDir = dirname(newPath)
    await mkdir(newDir, { recursive: true })
    await rename(oldPath, newPath)
    return { success: true }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err)) as FileOperationError
    error.code = 'RENAME_ERROR'
    error.path = oldPath
    return { success: false, error }
  }
}

// Copy file
export async function copyFileContent(sourcePath: string, destPath: string): Promise<FileOperationResult> {
  try {
    const destDir = dirname(destPath)
    await mkdir(destDir, { recursive: true })
    await copyFile(sourcePath, destPath)
    return { success: true }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err)) as FileOperationError
    error.code = 'COPY_ERROR'
    error.path = sourcePath
    return { success: false, error }
  }
}

// Get file stats
export async function getFileStats(path: string): Promise<FileOperationResult<FileStats>> {
  try {
    const stats = await stat(path)
    return {
      success: true,
      data: {
        size: stats.size,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        isSymbolicLink: stats.isSymbolicLink(),
        created: stats.birthtime,
        modified: stats.mtime,
        accessed: stats.atime,
        permissions: stats.mode.toString(8).slice(-3),
      },
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err)) as FileOperationError
    error.code = 'STATS_ERROR'
    error.path = path
    return { success: false, error }
  }
}

// Read directory contents
export async function readDirectoryContents(path: string): Promise<FileOperationResult<string[]>> {
  try {
    const entries = await readdir(path)
    return { success: true, data: entries }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err)) as FileOperationError
    error.code = 'READ_DIR_ERROR'
    error.path = path
    return { success: false, error }
  }
}

// Check write permission
export async function canWriteFile(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK)
    return true
  } catch {
    return false
  }
}

// Check read permission
export async function canReadFile(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

// Get file extension
export function getFileExtension(path: string): string {
  return extname(path).toLowerCase()
}

// Get filename without extension
export function getFileBasename(path: string, ext?: string): string {
  return basename(path, ext)
}

// Get directory name
export function getDirectoryName(path: string): string {
  return dirname(path)
}

// Join paths
export function joinFilePaths(...paths: string[]): string {
  return join(...paths)
}

// FileOperations class for backward compatibility
export class FileOperations {
  async exists(path: string): Promise<boolean> {
    return fileExists(path)
  }

  async readFile(path: string): Promise<FileOperationResult<string>> {
    return readFileContent(path)
  }

  async writeFile(path: string, content: string): Promise<FileOperationResult> {
    return writeFileContent(path, content)
  }

  async readBinaryFile(path: string): Promise<FileOperationResult<Buffer>> {
    return readBinaryFileContent(path)
  }

  async writeBinaryFile(path: string, content: Buffer): Promise<FileOperationResult> {
    return writeBinaryFileContent(path, content)
  }

  async deleteFile(path: string): Promise<FileOperationResult> {
    return deleteFileContent(path)
  }

  async renameFile(oldPath: string, newPath: string): Promise<FileOperationResult> {
    return renameFileContent(oldPath, newPath)
  }

  async copyFile(sourcePath: string, destPath: string): Promise<FileOperationResult> {
    return copyFileContent(sourcePath, destPath)
  }

  async getStats(path: string): Promise<FileOperationResult<FileStats>> {
    return getFileStats(path)
  }

  async readDirectory(path: string): Promise<FileOperationResult<string[]>> {
    return readDirectoryContents(path)
  }

  async canWrite(path: string): Promise<boolean> {
    return canWriteFile(path)
  }

  async canRead(path: string): Promise<boolean> {
    return canReadFile(path)
  }

  getExtension(path: string): string {
    return getFileExtension(path)
  }

  getBasename(path: string, ext?: string): string {
    return getFileBasename(path, ext)
  }

  getDirname(path: string): string {
    return getDirectoryName(path)
  }

  joinPath(...paths: string[]): string {
    return joinFilePaths(...paths)
  }
}

// React hook version
let React: any = null
try {
  React = require('react')
} catch {
  // React not available
}

export function useFileOperations() {
  if (!React) {
    // Return the class-based version for non-React environments
    return new FileOperations()
  }

  const { useCallback } = React

  const readFile = useCallback(readFileContent, [])
  const writeFile = useCallback(writeFileContent, [])
  const deleteFile = useCallback(deleteFileContent, [])
  const renameFile = useCallback(renameFileContent, [])
  const copyFile = useCallback(copyFileContent, [])
  const readDirectory = useCallback(readDirectoryContents, [])
  const getStats = useCallback(getFileStats, [])
  const canWrite = useCallback(canWriteFile, [])
  const canRead = useCallback(canReadFile, [])
  const exists = useCallback(fileExists, [])
  const readBinaryFile = useCallback(readBinaryFileContent, [])
  const writeBinaryFile = useCallback(writeBinaryFileContent, [])
  const getExtension = useCallback(getFileExtension, [])
  const getBasename = useCallback(getFileBasename, [])
  const getDirname = useCallback(getDirectoryName, [])
  const joinPath = useCallback(joinFilePaths, [])

  return {
    exists,
    readFile,
    writeFile,
    deleteFile,
    renameFile,
    copyFile,
    readDirectory,
    getStats,
    canWrite,
    canRead,
    getExtension,
    getBasename,
    getDirname,
    joinPath,
    readBinaryFile,
    writeBinaryFile,
  }
}
