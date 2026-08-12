import { act, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { CodeEditor } from './CodeEditor'

vi.mock('../../modules/theme/ThemeContext', () => ({
  useResolvedThemeMode: () => 'light',
}))

describe('CodeEditor', () => {
  it('does not apply a stale parent value over an edited document', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    if (!Range.prototype.getClientRects) {
      Object.defineProperty(Range.prototype, 'getClientRects', {
        configurable: true,
        value: () => [],
      })
    }

    let view: EditorView | null = null
    const onChange = vi.fn()

    const { rerender } = render(
      <CodeEditor
        value="initial"
        onChange={onChange}
        onViewReady={(nextView) => {
          view = nextView
        }}
      />,
    )

    await waitFor(() => {
      expect(view).not.toBeNull()
    })

    act(() => {
      view!.dispatch({
        changes: {
          from: view!.state.doc.length,
          insert: ' changed',
        },
      })
    })

    expect(view!.state.doc.toString()).toBe('initial changed')

    rerender(
      <CodeEditor
        value="initial"
        onChange={onChange}
        onViewReady={(nextView) => {
          view = nextView
        }}
      />,
    )

    expect(view!.state.doc.toString()).toBe('initial changed')
  })
})
