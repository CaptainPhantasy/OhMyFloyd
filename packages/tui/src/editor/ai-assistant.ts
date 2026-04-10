'use strict'

import type { MarkdownDocument, TextRange, AIResponse } from './types'

// AI response types
interface AICompletionRequest {
  prompt: string
  context: string
  documentType: string
}

interface AIAnalysisRequest {
  action: 'analyze' | 'styleCheck' | 'accessibilityAudit' | 'searchReplace'
  document: MarkdownDocument
  searchTerm?: string
  replacePrompt?: string
}

type AIRequest = AICompletionRequest | AIAnalysisRequest

// Priority task queue
interface PriorityTask {
  request: AIRequest
  priority: number
  resolve: (response: AIResponse) => void
  reject: (error: Error) => void
}

// Cache for AI responses
const aiResponseCache = new Map<string, AIResponse>()

// Priority queue for AI tasks
const priorityQueue: PriorityTask[] = []

// Configuration
const AI_TIMEOUT_MS = 30000
const MAX_CACHE_SIZE = 100

// AI Service configuration
let aiServiceConfig: {
  apiKey?: string
  model?: string
  baseUrl?: string
} = {}

/**
 * Configure the AI service for completions
 */
export function configureAIService(config: { apiKey?: string; model?: string; baseUrl?: string }): void {
  aiServiceConfig = { ...aiServiceConfig, ...config }
}

/**
 * Generate a cache key for the request
 */
function generateCacheKey(request: AIRequest): string {
  if ('prompt' in request) {
    return `${request.documentType}:${request.context.slice(-200)}:${request.prompt.slice(-100)}`
  }
  if (request.action === 'searchReplace') {
    return `searchReplace:${request.searchTerm}:${request.replacePrompt}`
  }
  return `${request.action}:${JSON.stringify(request.document).slice(-500)}`
}

/**
 * Check if AI service is available
 */
async function isAIServiceAvailable(): Promise<boolean> {
  // Check if we have configuration
  const apiKey = aiServiceConfig.apiKey || process.env?.AI_API_KEY || process.env?.ANTHROPIC_API_KEY
  if (!apiKey) {
    return false
  }

  // Try to connect to AI service
  try {
    const baseUrl = aiServiceConfig.baseUrl || 'https://api.anthropic.com/v1/messages'
    const response = await fetch(baseUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    })
    return response.ok || response.status === 405 // HEAD may not be allowed
  } catch {
    return false
  }
}

/**
 * Call the AI service with a request
 */
async function callAIService(request: AIRequest): Promise<AIResponse> {
  const cacheKey = generateCacheKey(request)

  // Check cache first
  if (aiResponseCache.has(cacheKey)) {
    return aiResponseCache.get(cacheKey)!
  }

  // Get API key from config or environment
  const apiKey = aiServiceConfig.apiKey || process.env?.AI_API_KEY || process.env?.ANTHROPIC_API_KEY
  if (!apiKey) {
    // Return a mock response when no API key is configured
    return generateMockResponse(request)
  }

  // Build the request
  const baseUrl = aiServiceConfig.baseUrl || 'https://api.anthropic.com/v1/messages'
  const model = aiServiceConfig.model || 'claude-sonnet-4-20250514'

  try {
    let systemPrompt = ''
    let userMessage = ''

    if ('prompt' in request) {
      systemPrompt = `You are a markdown editor assistant. Given the document context and prompt, provide helpful suggestions.`
      userMessage = `Context:\n${request.context}\n\nPrompt: ${request.prompt}`
    } else if (request.action === 'analyze') {
      systemPrompt = `You are a document analysis assistant. Analyze the markdown document and provide feedback.`
      userMessage = `Analyze this document:\n${request.document.content}`
    } else if (request.action === 'searchReplace') {
      systemPrompt = `You are a text transformation assistant. Apply the specified transformation.`
      userMessage = `Search for "${request.searchTerm}" and apply: ${request.replacePrompt}\n\nDocument:\n${request.document.content}`
    } else if (request.action === 'styleCheck') {
      systemPrompt = `You are a style checker for markdown documents.`
      userMessage = `Check style consistency:\n${request.document.content}`
    } else if (request.action === 'accessibilityAudit') {
      systemPrompt = `You are an accessibility auditor for markdown documents.`
      userMessage = `Audit accessibility:\n${request.document.content}`
    }

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    })

    if (!response.ok) {
      throw new Error(`AI service error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    const content = data.content?.[0]?.text || ''

    const aiResponse: AIResponse = {
      generatedContent: content,
      summary: extractSummary(content),
      keyPoints: extractKeyPoints(content),
      suggestions: extractSuggestions(content),
      changes: extractChanges(content),
      issues: extractIssues(content),
    }

    // Cache the response
    if (aiResponseCache.size >= MAX_CACHE_SIZE) {
      // Remove oldest entry
      const firstKey = aiResponseCache.keys().next().value
      if (firstKey) aiResponseCache.delete(firstKey)
    }
    aiResponseCache.set(cacheKey, aiResponse)

    return aiResponse
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))

    // Return a fallback response on error
    if (error.name === 'TimeoutError') {
      console.warn('AI request timed out, using fallback')
      return generateFallbackResponse(request)
    }

    throw error
  }
}

/**
 * Generate a mock response when AI is unavailable
 */
function generateMockResponse(request: AIRequest): AIResponse {
  if ('prompt' in request) {
    return {
      generatedContent: '# Suggested Content\n\nAdd your markdown here...',
      summary: 'Mock response - AI service not configured',
      keyPoints: [],
      suggestions: [],
      changes: [],
      issues: [],
    }
  }

  if (request.action === 'analyze') {
    return {
      generatedContent: '',
      summary: 'Document analysis complete',
      keyPoints: ['Consider adding more headings for structure', 'Add code examples for clarity'],
      suggestions: [],
      changes: [],
      issues: [],
    }
  }

  return {
    generatedContent: '',
    summary: '',
    keyPoints: [],
    suggestions: [],
    changes: [],
    issues: [],
  }
}

/**
 * Generate a fallback response when AI times out
 */
function generateFallbackResponse(request: AIRequest): AIResponse {
  return {
    generatedContent: request.action === 'analyze'
      ? 'Document analysis timed out. Please try again.'
      : 'AI request timed out. Please try again.',
    summary: 'Timeout - service unavailable',
    keyPoints: [],
    suggestions: [],
    changes: [],
    issues: [],
  }
}

/**
 * Extract summary from AI response text
 */
function extractSummary(text: string): string {
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length === 0) return ''
  // Return first few lines as summary
  return lines.slice(0, 3).join(' ').slice(0, 500)
}

/**
 * Extract key points from AI response
 */
function extractKeyPoints(text: string): string[] {
  const points: string[] = []
  const lines = text.split('\n')

  for (const line of lines) {
    // Look for bullet points or numbered lists
    const match = line.match(/^[\-\*]\s+(.+)$/)
    if (match) {
      points.push(match[1])
    }
  }

  return points.slice(0, 10)
}

/**
 * Extract suggestions from AI response
 */
function extractSuggestions(text: string): Array<{ range: TextRange; suggestion: string }> {
  // Parse suggestions from structured response
  const suggestions: Array<{ range: TextRange; suggestion: string }> = []
  const lines = text.split('\n')

  for (const line of lines) {
    // Look for suggestion patterns like "Line X: suggestion"
    const match = line.match(/^Suggestion \((\d+)-(\d+)\):\s*(.+)$/)
    if (match) {
      suggestions.push({
        range: {
          start: { line: parseInt(match[1]), character: 0 },
          end: { line: parseInt(match[2]), character: 0 },
        },
        suggestion: match[3],
      })
    }
  }

  return suggestions
}

/**
 * Extract changes from AI response
 */
function extractChanges(text: string): Array<{ range: TextRange; newText: string }> {
  const changes: Array<{ range: TextRange; newText: string }> = []

  // Parse change patterns
  const lines = text.split('\n')
  for (const line of lines) {
    const match = line.match(/^Change \((\d+),(\d+)\):\s*(.+)$/)
    if (match) {
      changes.push({
        range: {
          start: { line: parseInt(match[1]), character: 0 },
          end: { line: parseInt(match[2]), character: 0 },
        },
        newText: match[3],
      })
    }
  }

  return changes
}

/**
 * Extract issues from AI response
 */
function extractIssues(text: string): Array<{ range: TextRange; issue: string; fix?: string }> {
  const issues: Array<{ range: TextRange; issue: string; fix?: string }> = []

  // Parse issue patterns
  const lines = text.split('\n')
  for (const line of lines) {
    const match = line.match(/^Issue \((\d+)\):\s*(.+?)(?:\s+Fix:\s*(.+))?$/)
    if (match) {
      issues.push({
        range: {
          start: { line: parseInt(match[1]), character: 0 },
          end: { line: parseInt(match[1]), character: 100 },
        },
        issue: match[2],
        fix: match[3],
      })
    }
  }

  return issues
}

/**
 * Process the priority queue
 */
async function processPriorityQueue(): Promise<void> {
  if (priorityQueue.length === 0) return

  // Sort by priority (lower number = higher priority)
  priorityQueue.sort((a, b) => a.priority - b.priority)

  const task = priorityQueue.shift()!
  try {
    const response = await callAIService(task.request)
    task.resolve(response)
  } catch (error) {
    task.reject(error as Error)
  }

  // Process next task if any
  if (priorityQueue.length > 0) {
    // Use setImmediate to avoid blocking
    setImmediate(processPriorityQueue)
  }
}

/**
 * Generate context-aware markdown content based on document analysis.
 */
export async function generateContent(
  document: MarkdownDocument,
  prompt: string,
  position?: { line: number; character: number },
  priority: number = 1
): Promise<string> {
  // Analyze document context around the cursor position
  const context = extractContext(document, position)

  // Use priority scheduling
  const response = await new Promise<AIResponse>((resolve, reject) => {
    priorityQueue.push({
      request: {
        prompt,
        context,
        documentType: 'markdown',
      },
      priority,
      resolve,
      reject,
    })
    processPriorityQueue()
  })

  return response.generatedContent
}

/**
 * Insert smart templates for common markdown structures.
 */
export function insertTemplate(templateName: string, position?: { line: number; character: number }): string {
  const templates: Record<string, string> = {
    table: `| Header 1 | Header 2 | Header 3 |
|----------|----------|----------|
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |`,
    codeBlock: '```typescript\n// Your code here\n```',
    codeBlockJs: '```javascript\n// Your code here\n```',
    codeBlockPython: '```python\n# Your code here\n```',
    codeBlockRust: '```rust\n// Your code here\n```',
    codeBlockGo: '```go\n// Your code here\n```',
    listOrdered: '1. First item\n2. Second item\n3. Third item',
    listUnordered: '- First item\n- Second item\n- Third item',
    checkbox: '- [ ] Unchecked task\n- [x] Checked task',
    heading1: '# Heading 1\n',
    heading2: '## Heading 2\n',
    heading3: '### Heading 3\n',
    link: '[Link Text](https://example.com)',
    image: '![Alt Text](https://example.com/image.png)',
    blockquote: '> Quote text here',
    horizontalRule: '\n---\n',
    definitionList: 'Term\n: Definition\n',
    footnote: '[^1]\n\n[^1]: Footnote text',
    mathBlock: '$$\n\\frac{a}{b}\n$$',
    mermaid: '```mermaid\nflowchart TD\n    A[Start] --> B[End]\n```',
  }

  return templates[templateName] || ''
}

/**
 * Provides collaborative editing suggestions.
 */
export async function getEditingSuggestions(
  document: MarkdownDocument,
  priority: number = 2
): Promise<Array<{ range: TextRange; suggestion: string }>> {
  const analysis = await analyzeDocument(document, priority)
  return analysis.suggestions
}

/**
 * Analyzes and summarizes the document.
 */
export async function analyzeDocument(
  document: MarkdownDocument,
  priority: number = 2
): Promise<{
  summary: string
  keyPoints: string[]
  suggestions: Array<{ range: TextRange; suggestion: string }>
}> {
  const response = await new Promise<AIResponse>((resolve, reject) => {
    priorityQueue.push({
      request: {
        action: 'analyze',
        document,
      },
      priority,
      resolve,
      reject,
    })
    processPriorityQueue()
  })

  return {
    summary: response.summary,
    keyPoints: response.keyPoints,
    suggestions: response.suggestions,
  }
}

/**
 * AI-powered search and replace.
 */
export async function smartSearchReplace(
  document: MarkdownDocument,
  searchTerm: string,
  replacePrompt: string,
  priority: number = 3
): Promise<{ changes: Array<{ range: TextRange; newText: string }> }> {
  const response = await new Promise<AIResponse>((resolve, reject) => {
    priorityQueue.push({
      request: {
        action: 'searchReplace',
        document,
        searchTerm,
        replacePrompt,
      },
      priority,
      resolve,
      reject,
    })
    processPriorityQueue()
  })

  return { changes: response.changes }
}

/**
 * Checks for style consistency.
 */
export async function checkStyleConsistency(
  document: MarkdownDocument
): Promise<Array<{ range: TextRange; issue: string }>> {
  const aiResponse = await callAIService({
    action: 'styleCheck',
    document,
  })

  return aiResponse.issues.map(issue => ({
    range: issue.range,
    issue: issue.issue,
  }))
}

/**
 * Audits for accessibility best practices.
 */
export async function auditAccessibility(
  document: MarkdownDocument
): Promise<Array<{ range: TextRange; issue: string; fix: string }>> {
  const aiResponse = await callAIService({
    action: 'accessibilityAudit',
    document,
  })

  return aiResponse.issues.map(issue => ({
    range: issue.range,
    issue: issue.issue,
    fix: issue.fix || '',
  }))
}

/**
 * Extract context around the cursor position.
 */
function extractContext(document: MarkdownDocument, position?: { line: number; character: number }): string {
  if (!position || !document.content) {
    return document.content?.slice(-1000) || ''
  }

  const lines = document.content.split('\n')
  const { line: cursorLine, character: cursorChar } = position

  // Get surrounding lines
  const startLine = Math.max(0, cursorLine - 5)
  const endLine = Math.min(lines.length, cursorLine + 5)

  const contextLines = lines.slice(startLine, endLine)

  // Add position indicator
  let context = `--- Context around line ${cursorLine + 1}, column ${cursorChar + 1} ---\n`
  context += contextLines.join('\n')

  return context
}

/**
 * Clear the AI response cache.
 */
export function clearAICache(): void {
  aiResponseCache.clear()
}

/**
 * Get cache statistics.
 */
export function getCacheStats(): { size: number; maxSize: number } {
  return {
    size: aiResponseCache.size,
    maxSize: MAX_CACHE_SIZE,
  }
}

/**
 * Get AI service availability status.
 */
export async function getAIServiceStatus(): Promise<{ available: boolean; reason?: string }> {
  const available = await isAIServiceAvailable()
  if (!available) {
    const apiKey = aiServiceConfig.apiKey || process.env?.AI_API_KEY || process.env?.ANTHROPIC_API_KEY
    if (!apiKey) {
      return { available: false, reason: 'No API key configured' }
    }
    return { available: false, reason: 'AI service unreachable' }
  }
  return { available: true }
}
