import { describe, expect, it } from 'vitest'
import { getMarkdownOutlineFallbackTarget, getWysiwygOutlineNavigationTarget } from './outlineNavigation'
import type { OutlineItem } from './parser'

function createOutlineItem(partial: Partial<OutlineItem> = {}): OutlineItem {
  return {
    id: 'heading-1',
    level: 1,
    text: 'Heading',
    line: 3,
    searchText: 'Heading',
    ...partial,
  }
}

describe('outlineNavigation', () => {
  it('should build wysiwyg navigation target when headingIndex exists', () => {
    expect(getWysiwygOutlineNavigationTarget(createOutlineItem({ headingIndex: 2 }))).toEqual({
      headingIndex: 2,
      text: 'Heading',
      level: 1,
    })
  })

  it('should return null for wysiwyg navigation when headingIndex is missing', () => {
    expect(getWysiwygOutlineNavigationTarget(createOutlineItem())).toBeNull()
  })

  it('should build markdown fallback target when line is valid', () => {
    expect(getMarkdownOutlineFallbackTarget(createOutlineItem({ line: 5, searchText: 'Section' }))).toEqual({
      line: 5,
      searchText: 'Section',
    })
  })

  it('should return null for markdown fallback when line is invalid', () => {
    expect(getMarkdownOutlineFallbackTarget(createOutlineItem({ line: 0 }))).toBeNull()
  })
})
