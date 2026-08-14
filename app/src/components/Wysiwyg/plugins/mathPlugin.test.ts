import { afterEach, describe, expect, it } from 'vitest'
import { inputRules } from '@milkdown/prose/inputrules'
import { Schema, type Node as ProseMirrorNode } from '@milkdown/prose/model'
import { EditorState, TextSelection, type Plugin } from '@milkdown/prose/state'
import { EditorView } from '@milkdown/prose/view'
import {
  createMathBlockInputRule,
  createMathDisplayInputPlugin,
  createMathInlineInputRule,
} from './mathPlugin'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      content: 'inline*',
      group: 'block',
      toDOM: () => ['p', 0],
    },
    math_display: {
      content: 'text*',
      group: 'block',
      code: true,
      toDOM: () => ['div', { class: 'math-display' }, 0],
    },
    math_inline: {
      content: 'text*',
      group: 'inline',
      inline: true,
      code: true,
      toDOM: () => ['span', { class: 'math-inline' }, 0],
    },
    text: { group: 'inline' },
  },
})

let view: EditorView | null = null

afterEach(() => {
  view?.destroy()
  view = null
})

function createView(
  doc: ProseMirrorNode,
  plugins: Plugin[],
) {
  const mount = document.createElement('div')
  view = new EditorView(mount, {
    state: EditorState.create({ schema, doc, plugins }),
  })
  return view
}

function typeText(editorView: EditorView, text: string) {
  for (const character of text) {
    const from = editorView.state.selection.from
    const to = editorView.state.selection.to
    const handled = editorView.someProp('handleTextInput', (handler) =>
      handler(editorView, from, to, character, () => editorView.state.tr),
    )
    if (!handled) {
      editorView.dispatch(editorView.state.tr.insertText(character, from, to))
    }
  }
}

describe('WYSIWYG math input', () => {
  it('converts a completed inline formula while typing', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph')])
    const editorView = createView(doc, [
      inputRules({
        rules: [createMathInlineInputRule(schema.nodes.math_inline!)],
      }),
    ])

    typeText(editorView, '$x^2$')

    const paragraph = editorView.state.doc.firstChild!
    expect(paragraph.firstChild?.type.name).toBe('math_inline')
    expect(paragraph.textContent).toBe('x^2')
  })

  it('converts a single-line display formula while typing', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph')])
    const editorView = createView(doc, [
      inputRules({
        rules: [createMathBlockInputRule(schema.nodes.math_display!)],
      }),
    ])

    typeText(editorView, '$$x^2$$')

    expect(editorView.state.doc.firstChild?.type.name).toBe('math_display')
    expect(editorView.state.doc.firstChild?.textContent).toBe('x^2')
  })

  it('converts a multiline display formula after the closing delimiter', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('$$')),
      schema.node('paragraph', null, schema.text('x^2')),
      schema.node('paragraph'),
    ])
    const editorView = createView(doc, [createMathDisplayInputPlugin()])
    const closingParagraphStart =
      doc.child(0)!.nodeSize + doc.child(1)!.nodeSize
    editorView.dispatch(
      editorView.state.tr.setSelection(TextSelection.create(
        editorView.state.doc,
        closingParagraphStart + 1,
      )),
    )

    typeText(editorView, '$$')

    expect(editorView.state.doc.childCount).toBe(2)
    expect(editorView.state.doc.firstChild?.type.name).toBe('math_display')
    expect(editorView.state.doc.firstChild?.textContent).toBe('x^2')
    expect(editorView.state.doc.lastChild?.type.name).toBe('paragraph')
    expect(editorView.state.selection.$from.parent.type.name).toBe('paragraph')
  })
})
