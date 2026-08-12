import { afterEach, describe, expect, it } from 'vitest'
import { Schema } from '@milkdown/prose/model'
import { EditorState } from '@milkdown/prose/state'
import { EditorView } from '@milkdown/prose/view'
import {
  createProseMirrorSearchController,
  createTextareaSearchController,
  type SearchOptions,
} from './searchController'

const searchOptions: SearchOptions = {
  searchText: 'alpha',
  caseSensitive: false,
  wholeWord: false,
  regexp: false,
}

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block', toDOM: () => ['p', 0] },
    text: { group: 'inline' },
  },
})

let proseMirrorView: EditorView | null = null

afterEach(() => {
  proseMirrorView?.destroy()
  proseMirrorView = null
})

describe('search controllers', () => {
  it('searches and replaces text in a WYSIWYG ProseMirror document', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('alpha beta')),
      schema.node('paragraph', null, schema.text('alpha gamma')),
    ])
    const mount = document.createElement('div')
    proseMirrorView = new EditorView(mount, {
      state: EditorState.create({ schema, doc }),
    })
    const controller = createProseMirrorSearchController(proseMirrorView)

    expect(controller.apply(searchOptions)).toEqual({
      matchCount: 2,
      currentMatchIndex: 1,
    })
    expect(controller.navigate('next', searchOptions)).toEqual({
      matchCount: 2,
      currentMatchIndex: 1,
    })
    expect(controller.navigate('next', searchOptions)).toEqual({
      matchCount: 2,
      currentMatchIndex: 2,
    })

    controller.replace(searchOptions, 'delta', false)
    expect(proseMirrorView.state.doc.textBetween(0, proseMirrorView.state.doc.content.size, '\n')).toBe('alpha beta\ndelta gamma')
  })

  it('searches and replaces text in a plain-text WYSIWYG textarea', () => {
    const textarea = document.createElement('textarea')
    textarea.value = 'alpha beta alpha'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.setSelectionRange(0, 0)
    const controller = createTextareaSearchController(textarea)

    expect(controller.apply(searchOptions)).toEqual({
      matchCount: 2,
      currentMatchIndex: 1,
    })
    expect(controller.navigate('next', searchOptions)).toEqual({
      matchCount: 2,
      currentMatchIndex: 1,
    })
    expect(controller.navigate('next', searchOptions)).toEqual({
      matchCount: 2,
      currentMatchIndex: 2,
    })

    controller.replace(searchOptions, 'delta', true)
    expect(textarea.value).toBe('delta beta delta')
    textarea.remove()
  })
})
