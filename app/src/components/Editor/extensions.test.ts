import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createExtensions, deleteEmptyMathFormula } from './extensions'

let view: EditorView | null = null

beforeEach(() => {
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
})

afterEach(() => {
  view?.destroy()
  view = null
})

function createView(source: string): EditorView {
  const parent = document.createElement('div')
  view = new EditorView({
    state: EditorState.create({
      doc: source,
      extensions: createExtensions({
        themeMode: 'light',
        showLineNumbers: false,
        showActiveLine: false,
        enableAutocomplete: false,
      }),
    }),
    parent,
  })
  return view
}

function pressDelete(editorView: EditorView): boolean {
  const before = editorView.state.doc.toString()
  const event = new KeyboardEvent('keydown', {
    key: 'Delete',
    bubbles: true,
    cancelable: true,
  })
  editorView.contentDOM.dispatchEvent(event)
  return editorView.state.doc.toString() !== before
}

describe('source editor math deletion', () => {
  it('deletes an empty display formula after its content was deleted', () => {
    const editorView = createView('before\n$$x$$\nafter')
    const formulaStart = editorView.state.doc.toString().indexOf('$$')

    editorView.dispatch({
      selection: { anchor: formulaStart + 2 },
    })
    expect(pressDelete(editorView)).toBe(true)
    expect(editorView.state.doc.toString()).toBe('before\n$$$$\nafter')

    editorView.dispatch({
      selection: { anchor: formulaStart + 2 },
    })
    expect(pressDelete(editorView)).toBe(true)
    expect(editorView.state.doc.toString()).toBe('before\nafter')
  })

  it('deletes an empty multiline display formula as one block', () => {
    const source = 'before\n$$\n\n$$\nafter'
    const editorView = createView(source)
    const formulaStart = source.indexOf('$$')

    editorView.dispatch({
      selection: { anchor: formulaStart + 2 },
    })
    expect(pressDelete(editorView)).toBe(true)
    expect(editorView.state.doc.toString()).toBe('before\nafter')
  })

  it('does not delete empty dollar pairs inside a fenced code block', () => {
    const source = '```\n$$ $$\n```'
    const editorView = createView(source)
    const formulaStart = source.indexOf('$$ $$')

    editorView.dispatch({
      selection: { anchor: formulaStart + 3 },
    })
    expect(deleteEmptyMathFormula(editorView)).toBe(false)
    expect(editorView.state.doc.toString()).toBe(source)
  })
})
