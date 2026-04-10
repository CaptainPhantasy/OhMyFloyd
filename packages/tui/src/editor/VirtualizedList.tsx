'use strict'

// Virtualized list for rendering large content efficiently
// This is a non-React implementation for Node.js/TUI environments

export interface VirtualizedListItem {
  text: string
  index: number
}

export interface VirtualizedListState {
  scrollTop: number
  visibleStartIndex: number
  visibleEndIndex: number
  totalItems: number
}

export interface VirtualizedListOptions {
  itemHeight: number
  overscanCount: number
  containerHeight: number
}

export class VirtualizedListManager {
  private lines: string[]
  private itemHeight: number
  private overscanCount: number
  private containerHeight: number
  private scrollTop: number = 0

  constructor(content: string, options: Partial<VirtualizedListOptions> = {}) {
    this.lines = content.split('\n')
    this.itemHeight = options.itemHeight ?? 1
    this.overscanCount = options.overscanCount ?? 5
    this.containerHeight = options.containerHeight ?? 100
  }

  get totalItems(): number {
    return this.lines.length
  }

  get totalHeight(): number {
    return this.lines.length * this.itemHeight
  }

  get visibleRange(): { start: number; end: number } {
    const startIndex = Math.max(0, Math.floor(this.scrollTop / this.itemHeight) - this.overscanCount)
    const endIndex = Math.min(
      this.lines.length,
      Math.ceil((this.scrollTop + this.containerHeight) / this.itemHeight) + this.overscanCount
    )
    return { start: startIndex, end: endIndex }
  }

  get visibleLines(): VirtualizedListItem[] {
    const { start, end } = this.visibleRange
    const items: VirtualizedListItem[] = []

    for (let i = start; i < end; i++) {
      items.push({
        text: this.lines[i] ?? '',
        index: i,
      })
    }

    return items
  }

  setScrollTop(scrollTop: number): void {
    this.scrollTop = Math.max(0, Math.min(scrollTop, this.totalHeight - this.containerHeight))
  }

  scrollBy(delta: number): void {
    this.setScrollTop(this.scrollTop + delta)
  }

  scrollToIndex(index: number): void {
    const targetScrollTop = index * this.itemHeight
    this.setScrollTop(targetScrollTop)
  }

  getScrollState(): VirtualizedListState {
    const { start, end } = this.visibleRange
    return {
      scrollTop: this.scrollTop,
      visibleStartIndex: start,
      visibleEndIndex: end,
      totalItems: this.totalItems,
    }
  }

  // Render the visible lines as strings
  renderLines(): string[] {
    return this.visibleLines.map(item => item.text || ' ')
  }

  // Render with line numbers
  renderWithLineNumbers(): string[] {
    return this.visibleLines.map(item => {
      const lineNum = String(item.index + 1).padStart(4, ' ')
      return `${lineNum} │ ${item.text || ' '}`
    })
  }

  // Handle scroll wheel event (for TUI input)
  handleWheel(deltaY: number): void {
    const scrollAmount = deltaY > 0 ? this.itemHeight * 3 : -this.itemHeight * 3
    this.scrollBy(scrollAmount)
  }
}

/**
 * Hook-style API for virtualized list state management
 */
export function useVirtualizedList(totalItems: number, itemHeight: number) {
  let scrollTop = 0
  let containerHeight = 100

  const setScrollTop = (newScrollTop: number) => {
    scrollTop = Math.max(0, Math.min(newScrollTop, totalItems * itemHeight - containerHeight))
  }

  const handleScroll = (newScrollTop: number) => {
    setScrollTop(newScrollTop)
  }

  const visibleRange = {
    start: Math.floor(scrollTop / itemHeight),
    end: Math.ceil((scrollTop + containerHeight) / itemHeight),
  }

  return {
    scrollTop,
    containerHeight,
    setContainerHeight: (h: number) => { containerHeight = h },
    handleScroll,
    visibleRange,
    totalHeight: totalItems * itemHeight,
  }
}

/**
 * Render content with virtualization
 * Returns the lines that should be visible given the scroll position
 */
export function virtualizeContent(
  content: string,
  scrollTop: number,
  containerHeight: number,
  options: { itemHeight?: number; overscanCount?: number } = {}
): { lines: string[]; startIndex: number; endIndex: number; totalLines: number } {
  const lines = content.split('\n')
  const itemHeight = options.itemHeight ?? 1
  const overscanCount = options.overscanCount ?? 5

  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscanCount)
  const endIndex = Math.min(
    lines.length,
    Math.ceil((scrollTop + containerHeight) / itemHeight) + overscanCount
  )

  const visibleLines = lines.slice(startIndex, endIndex)

  return {
    lines: visibleLines,
    startIndex,
    endIndex,
    totalLines: lines.length,
  }
}

/**
 * VirtualizedList component for rendering large content
 * Main export for backward compatibility
 */
export const VirtualizedList = VirtualizedListManager

/**
 * Calculate scroll position for a specific line
 */
export function getScrollPositionForLine(
  lineIndex: number,
  itemHeight: number,
  containerHeight: number,
  totalLines: number
): number {
  const lineTop = lineIndex * itemHeight
  const lineBottom = lineTop + itemHeight

  // Center the line if possible
  const targetScroll = lineTop - containerHeight / 2

  // Clamp to valid range
  const maxScroll = Math.max(0, totalLines * itemHeight - containerHeight)
  return Math.max(0, Math.min(targetScroll, maxScroll))
}
