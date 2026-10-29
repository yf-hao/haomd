import { Schema } from '@milkdown/prose/model'
import { EditorState } from '@milkdown/prose/state'
import { history, closeHistory, undo, redo } from '@milkdown/prose/history'
import type { EditorView } from '@milkdown/prose/view'
import { expect, it } from 'vitest'
import { relocateProseMirrorDocument } from './relocateDocument'

it('preserves rich-text undo/redo with relocated link attributes', () => {
  const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} },
    marks: { link: { attrs: { href: {} } } } })
  const document = (href: string) => schema.node('doc', null, [schema.node('paragraph', null,
    [schema.text('link', [schema.mark('link', { href })])])])
  let state = EditorState.create({ schema, doc: document('old.md'), plugins: [history()] })
  state = state.apply(closeHistory(state.tr).replaceWith(0, state.doc.content.size, document('changed.md').content))
  state = state.apply(closeHistory(state.tr).insertText(' next', 5))
  undo(state, transaction => { state = state.apply(transaction) })
  const view = { get state() { return state }, updateState(next: EditorState) { state = next } } as EditorView
  relocateProseMirrorDocument(view, '/old/note.md', { oldPath: '/old/note.md', newPath: '/new/note.md' })
  expect(state.doc.firstChild?.firstChild?.marks[0].attrs.href).toBe('../old/changed.md')
  undo(state, transaction => { state = state.apply(transaction) })
  expect(state.doc.firstChild?.firstChild?.marks[0].attrs.href).toBe('../old/old.md')
  redo(state, transaction => { state = state.apply(transaction) })
  redo(state, transaction => { state = state.apply(transaction) })
  expect(state.doc.textContent).toBe('link next')
})
