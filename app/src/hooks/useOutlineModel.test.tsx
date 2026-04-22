import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useOutlineModel } from './useOutlineModel'

describe('useOutlineModel', () => {
  it('should use markdown headings in source mode', () => {
    const { result } = renderHook(() =>
      useOutlineModel({
        mode: 'source',
        markdown: '# Title\n\n## Section',
        wysiwygHeadings: [],
        debounceMs: 0,
      }),
    )

    expect(result.current).toHaveLength(1)
    expect(result.current[0].text).toBe('Title')
    expect(result.current[0].children?.[0].text).toBe('Section')
    expect(result.current[0].source).toBe('markdown')
  })

  it('should use wysiwyg headings in wysiwyg mode', () => {
    const { result } = renderHook(() =>
      useOutlineModel({
        mode: 'wysiwyg',
        markdown: '# Markdown Title',
        wysiwygHeadings: [
          {
            id: 'wysiwyg-heading-0',
            text: 'Visual Title',
            level: 1,
            source: 'wysiwyg',
            headingIndex: 0,
          },
          {
            id: 'wysiwyg-heading-1',
            text: 'Visual Section',
            level: 2,
            source: 'wysiwyg',
            headingIndex: 1,
          },
        ],
      }),
    )

    expect(result.current).toHaveLength(1)
    expect(result.current[0].text).toBe('Visual Title')
    expect(result.current[0].children?.[0].text).toBe('Visual Section')
    expect(result.current[0].source).toBe('wysiwyg')
    expect(result.current[0].headingIndex).toBe(0)
  })
})
