// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useAiSlashCommandHints } from './useAiSlashCommandHints'

describe('useAiSlashCommandHints', () => {
  it('does not open hints unless the current line starts with /', () => {
    const { result, rerender } = renderHook(
      ({ input, cursorIndex }) => useAiSlashCommandHints({ input, cursorIndex }),
      {
        initialProps: {
          input: 'hello world',
          cursorIndex: 11,
        },
      },
    )

    expect(result.current.isOpen).toBe(false)
    expect(result.current.items).toHaveLength(0)

    rerender({
      input: 'hello /cl',
      cursorIndex: 9,
    })

    expect(result.current.isOpen).toBe(false)
    expect(result.current.items).toHaveLength(0)
  })

  it('opens hints for a slash command at line start', () => {
    const { result } = renderHook(() =>
      useAiSlashCommandHints({
        input: '/cl',
        cursorIndex: 3,
      }),
    )

    expect(result.current.isOpen).toBe(true)
    expect(result.current.query).toBe('cl')
    expect(result.current.items.map((item) => item.name)).toContain('clear')
  })
})
