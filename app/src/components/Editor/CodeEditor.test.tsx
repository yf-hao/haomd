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
        documentKey="doc-1"
        preserveLocalDocument
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
        value="stale parent"
        documentKey="doc-1"
        preserveLocalDocument
        onChange={onChange}
        onViewReady={(nextView) => {
          view = nextView
        }}
      />,
    )

    expect(view!.state.doc.toString()).toBe('initial changed')

    rerender(
      <CodeEditor
        value="replacement"
        documentKey="doc-2"
        preserveLocalDocument
        onChange={onChange}
        onViewReady={(nextView) => {
          view = nextView
        }}
      />,
    )

    expect(view!.state.doc.toString()).toBe('replacement')
  })

  it('reports document changes through the editor view callback', async () => {
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
    const onDocumentChange = vi.fn()

    render(
      <CodeEditor
        value="initial"
        onDocumentChange={onDocumentChange}
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

    const change = onDocumentChange.mock.calls[0][0]
    expect(change.view).toBe(view)
    expect(change.changes).toBeDefined()
  })
})
