import { buildOutlineFromMarkdown, buildOutlineTree, type OutlineItem } from './parser'

export type OutlineHeadingSource = 'markdown' | 'wysiwyg'

export type OutlineHeading = {
  id: string
  text: string
  level: 1 | 2 | 3 | 4 | 5 | 6
  source: OutlineHeadingSource
  line?: number
  searchText?: string
  headingIndex?: number
}

export function buildHeadingsFromMarkdown(markdown: string): OutlineHeading[] {
  return buildOutlineFromMarkdown(markdown).map((item) => ({
    id: item.id,
    text: item.text,
    level: item.level,
    source: 'markdown',
    line: item.line,
    searchText: item.searchText,
  }))
}

export function buildOutlineTreeFromHeadings(headings: OutlineHeading[]): OutlineItem[] {
  const items: OutlineItem[] = headings.map((heading, index) => ({
    id: heading.id,
    text: heading.text,
    level: heading.level,
    line: heading.line ?? index + 1,
    searchText: heading.searchText ?? heading.text,
    source: heading.source,
    headingIndex: heading.headingIndex,
  }))

  return buildOutlineTree(items)
}
