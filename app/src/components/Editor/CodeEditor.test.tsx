import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { CodeEditor } from './CodeEditor'

vi.mock('../../modules/theme/ThemeContext', () => ({
  useResolvedThemeMode: () => 'light',
}))

describe('CodeEditor', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true, value: () => new DOMRect(),
    })
  })
  it('keeps transaction-only typing and unrelated renders free of full-document string conversion', async () => {
    const initial = 'A long paragraph for the source editor.\n'.repeat(3000)
    let view: EditorView | null = null
    const onDocumentChange = vi.fn()
    const onViewReady = (next: EditorView | null) => { view = next }
    const { rerender, unmount } = render(
      <CodeEditor value={initial} documentKey="large" preserveLocalDocument
        onDocumentChange={onDocumentChange} onViewReady={onViewReady} />,
    )
    await waitFor(() => expect(view).not.toBeNull())
    const stringify = vi.spyOn(Object.getPrototypeOf(view!.state.doc), 'toString')
    try {
      act(() => {
        for (let index = 0; index < 20; index++) {
          view!.dispatch({ changes: { from: view!.state.doc.length, insert: 'x' } })
        }
      })
      rerender(<CodeEditor value={initial} documentKey="large" preserveLocalDocument
        editorZoom={1.2} onDocumentChange={onDocumentChange} onViewReady={onViewReady} />)
      expect(onDocumentChange).toHaveBeenCalledTimes(20)
      expect(stringify.mock.contexts.filter(doc => doc.length >= initial.length)).toHaveLength(0)
      expect(view!.state.doc.length).toBe(initial.length + 20)
      rerender(<CodeEditor value="different document" documentKey="other" preserveLocalDocument
        onDocumentChange={onDocumentChange} onViewReady={onViewReady} />)
      expect(view!.state.doc.sliceString(0)).toBe('different document')
    } finally {
      stringify.mockRestore()
      unmount()
    }
  })

  it('publishes composed source text and keeps a stale parent value from replacing it', async () => {
    let view: EditorView | null = null
    const onDocumentChange = vi.fn()
    const onViewReady = (next: EditorView | null) => { view = next }
    const { container, rerender } = render(
      <CodeEditor value="before" documentKey="ime" preserveLocalDocument
        onDocumentChange={onDocumentChange} onViewReady={onViewReady} />,
    )
    await waitFor(() => expect(view).not.toBeNull())
    fireEvent.compositionStart(container.firstChild!)
    act(() => { view!.dispatch({ changes: { from: 6, insert: '中文' } }) })
    rerender(<CodeEditor value="stale" documentKey="ime" preserveLocalDocument
      onDocumentChange={onDocumentChange} onViewReady={onViewReady} />)
    await act(async () => { fireEvent.compositionEnd(container.firstChild!) })
    expect(view!.state.doc.sliceString(0)).toBe('before中文')
    expect(onDocumentChange).toHaveBeenCalled()
  })

  it('does not deliver an outgoing composition to the next document', async () => {
    let view: EditorView | null = null
    const onDocumentChange = vi.fn()
    const onViewReady = (next: EditorView | null) => { view = next }
    const { container, rerender } = render(<CodeEditor value="A" documentKey="A" preserveLocalDocument
      onDocumentChange={onDocumentChange} onViewReady={onViewReady} />)
    await waitFor(() => expect(view).not.toBeNull())
    fireEvent.compositionStart(container.firstChild!)
    act(() => { view!.dispatch({ changes: { from: 1, insert: '中' } }) })
    rerender(<CodeEditor value="B" documentKey="B" preserveLocalDocument
      onDocumentChange={onDocumentChange} onViewReady={onViewReady} />)
    await act(async () => { fireEvent.compositionEnd(container.firstChild!) })
    expect(view!.state.doc.sliceString(0)).toBe('B')
    expect(onDocumentChange).not.toHaveBeenCalled()
  })

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
