import { describe, expect, it } from 'vitest'
import { buildHeadingsFromMarkdown, buildOutlineTreeFromHeadings, type OutlineHeading } from './outlineSource'

describe('outlineSource', () => {
  it('should adapt markdown headings into the unified heading model', () => {
    const headings = buildHeadingsFromMarkdown('# Title\n\n## Section')

    expect(headings).toEqual([
      {
        id: 'h-1-0',
        text: 'Title',
        level: 1,
        source: 'markdown',
        line: 1,
        searchText: 'Title',
      },
      {
        id: 'h-2-1',
        text: 'Section',
        level: 2,
        source: 'markdown',
        line: 3,
        searchText: 'Section',
      },
    ])
  })

  it('should convert unified headings into the existing outline tree shape', () => {
    const headings: OutlineHeading[] = [
      {
        id: 'root',
        text: 'Root',
        level: 1,
        source: 'wysiwyg',
        headingIndex: 0,
      },
      {
        id: 'child',
        text: 'Child',
        level: 2,
        source: 'wysiwyg',
        headingIndex: 1,
      },
    ]

    const items = buildOutlineTreeFromHeadings(headings)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'root',
      text: 'Root',
      level: 1,
      line: 1,
      searchText: 'Root',
      source: 'wysiwyg',
      headingIndex: 0,
    })
    expect(items[0].children?.[0]).toMatchObject({
      id: 'child',
      text: 'Child',
      level: 2,
      line: 2,
      searchText: 'Child',
      source: 'wysiwyg',
      headingIndex: 1,
    })
  })
})
