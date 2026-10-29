import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { undo, redo, isolateHistory } from '@codemirror/commands'
import { afterEach, expect, it, vi } from 'vitest'
import { documentHistoryExtension, relocateCodeMirrorDocument } from './relocateDocument'

afterEach(() => vi.unstubAllGlobals())

it('rebases current content and both undo and redo branches without replacing the view', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  const view = new EditorView({ state: EditorState.create({ doc: '[link](original.md)', extensions: [documentHistoryExtension()] }) })
  view.dispatch({ changes: { from: 7, to: 18, insert: 'changed.md' }, annotations: isolateHistory.of('full') })
  view.dispatch({ changes: { from: view.state.doc.length, insert: ' next' }, annotations: isolateHistory.of('full') })
  undo(view)
  relocateCodeMirrorDocument(view, '/old/note.md', { oldPath: '/old/note.md', newPath: '/new/note01.md' })
  expect(view.state.doc.toString()).toBe('[link](../old/changed.md)')
  undo(view)
  expect(view.state.doc.toString()).toBe('[link](../old/original.md)')
  redo(view)
  redo(view)
  expect(view.state.doc.toString()).toBe('[link](../old/changed.md) next')
  view.destroy()
})
