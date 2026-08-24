import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { OutlineHeading } from '../modules/outline/outlineSource'
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

  it('should debounce source heading parsing while typing', () => {
    vi.useFakeTimers()
    try {
      const { result, rerender } = renderHook(
        ({ markdown }) => useOutlineModel({
          mode: 'source',
          markdown,
          wysiwygHeadings: [],
          enabled: true,
          debounceMs: 300,
          documentKey: 'doc-1',
        }),
        { initialProps: { markdown: '# Initial' } },
      )

      expect(result.current[0].text).toBe('Initial')

      rerender({ markdown: '# Updated' })
      expect(result.current[0].text).toBe('Initial')

      act(() => {
        vi.advanceTimersByTime(299)
      })
      expect(result.current[0].text).toBe('Initial')

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(result.current[0].text).toBe('Updated')
    } finally {
      vi.useRealTimers()
    }
  })

  it('should sync immediately when the outline is enabled for another document', () => {
    vi.useFakeTimers()
    try {
      const { result, rerender } = renderHook(
        ({ enabled, documentKey, markdown }) => useOutlineModel({
          mode: 'source',
          markdown,
          wysiwygHeadings: [],
          enabled,
          debounceMs: 300,
          documentKey,
        }),
        {
          initialProps: {
            enabled: true,
            documentKey: 'doc-1',
            markdown: '# First',
          },
        },
      )

      rerender({
        enabled: true,
        documentKey: 'doc-2',
        markdown: '# Second',
      })

      expect(result.current[0].text).toBe('Second')
    } finally {
      vi.useRealTimers()
    }
  })

  it('should clear the outline when there is no active document', () => {
    const { result, rerender } = renderHook(
      ({ documentKey, markdown }) => useOutlineModel({
        mode: 'source',
        markdown,
        wysiwygHeadings: [],
        enabled: true,
        documentKey,
      }),
      {
        initialProps: {
          documentKey: 'doc-1' as string | null,
          markdown: '# Existing title',
        },
      },
    )

    expect(result.current).toHaveLength(1)

    rerender({ documentKey: null, markdown: '# Existing title' })

    expect(result.current).toEqual([])
  })

  it('should not rebuild the outline when only body text changes', () => {
    vi.useFakeTimers()
    try {
      const wysiwygHeadings: OutlineHeading[] = []
      const { result, rerender } = renderHook(
        ({ markdown }) => useOutlineModel({
          mode: 'source',
          markdown,
          wysiwygHeadings,
          enabled: true,
          debounceMs: 300,
          documentKey: 'doc-1',
        }),
        { initialProps: { markdown: '# Title\n\nBody' } },
      )
      const initialOutline = result.current

      rerender({ markdown: '# Title\n\nUpdated body' })
      act(() => {
        vi.advanceTimersByTime(300)
      })

      expect(result.current).toBe(initialOutline)
    } finally {
      vi.useRealTimers()
    }
  })

  it('should not rebuild the outline when line count changes after the last heading', () => {
    vi.useFakeTimers()
    try {
      const wysiwygHeadings: OutlineHeading[] = []
      const { result, rerender } = renderHook(
        ({ markdown }) => useOutlineModel({
          mode: 'source',
          markdown,
          wysiwygHeadings,
          enabled: true,
          debounceMs: 300,
          documentKey: 'doc-1',
        }),
        { initialProps: { markdown: '# Title\n\nBody' } },
      )
      const initialOutline = result.current

      rerender({ markdown: '# Title\n\nBody\n\nInserted line' })
      act(() => {
        vi.advanceTimersByTime(300)
      })

      expect(result.current).toBe(initialOutline)
    } finally {
      vi.useRealTimers()
    }
  })

  it('should rebuild the outline when body changes move a heading', () => {
    vi.useFakeTimers()
    try {
      const { result, rerender } = renderHook(
        ({ markdown }) => useOutlineModel({
          mode: 'source',
          markdown,
          wysiwygHeadings: [],
          enabled: true,
          debounceMs: 300,
          documentKey: 'doc-1',
        }),
        { initialProps: { markdown: '# Title' } },
      )

      rerender({ markdown: 'Inserted line\n# Title' })
      act(() => {
        vi.advanceTimersByTime(300)
      })

      expect(result.current[0].line).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('should update later heading lines when body lines are inserted between headings', () => {
    vi.useFakeTimers()
    try {
      const { result, rerender } = renderHook(
        ({ markdown }) => useOutlineModel({
          mode: 'source',
          markdown,
          wysiwygHeadings: [],
          enabled: true,
          debounceMs: 300,
          documentKey: 'doc-1',
        }),
        { initialProps: { markdown: '# Title\n\nBody\n\n## Section' } },
      )

      rerender({ markdown: '# Title\n\nBody\nInserted line\n\n## Section' })
      act(() => {
        vi.advanceTimersByTime(300)
      })

      expect(result.current[0].children?.[0].line).toBe(6)
    } finally {
      vi.useRealTimers()
    }
  })
})
