import type { OutlineItem } from './parser'

export type WysiwygOutlineNavigationTarget = {
  headingIndex: number
  text: string
  level: 1 | 2 | 3 | 4 | 5 | 6
}

export type MarkdownOutlineFallbackTarget = {
  line: number
  searchText: string
}

export function getWysiwygOutlineNavigationTarget(item: OutlineItem): WysiwygOutlineNavigationTarget | null {
  if (typeof item.headingIndex !== 'number') return null
  return {
    headingIndex: item.headingIndex,
    text: item.text,
    level: item.level,
  }
}

export function getMarkdownOutlineFallbackTarget(item: OutlineItem): MarkdownOutlineFallbackTarget | null {
  if (typeof item.line !== 'number' || item.line < 1) return null
  return {
    line: item.line,
    searchText: item.searchText,
  }
}
