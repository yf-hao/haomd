import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { SearchQuery } from '@codemirror/search'
import { customSearchHighlight, searchHighlightPlugin, setCustomSearchQuery } from './searchHighlight'

let view: EditorView
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  view = new EditorView({ parent: document.body, state: EditorState.create({
    doc: 'match body match', extensions: customSearchHighlight(),
  }) })
})
afterEach(() => { view.destroy(); vi.restoreAllMocks(); vi.useRealTimers() })

it('reuses the match index when only the selection moves', () => {
  const query = new SearchQuery({ search: 'match' })
  const cursor = vi.spyOn(query, 'getCursor')
  view.dispatch({ effects: setCustomSearchQuery.of(query) })
  view.dispatch({ selection: { anchor: 12 } })
  expect(cursor).toHaveBeenCalledOnce()
  expect(view.plugin(searchHighlightPlugin)!.selectedDecorations.size).toBe(1)
})

it('refreshes changed matches after typing and cancels obsolete searches', () => {
  vi.useFakeTimers()
  const query = new SearchQuery({ search: 'match' })
  const cursor = vi.spyOn(query, 'getCursor')
  view.dispatch({ effects: setCustomSearchQuery.of(query) })
  view.dispatch({ changes: { from: 0, to: 5, insert: 'other' } })
  expect(cursor).toHaveBeenCalledOnce()
  vi.advanceTimersByTime(100)
  expect(cursor).toHaveBeenCalledTimes(2)
  expect(view.plugin(searchHighlightPlugin)!.decorations.size).toBe(1)
  view.dispatch({ changes: { from: 0, insert: 'match ' } })
  view.dispatch({ effects: setCustomSearchQuery.of(null) })
  vi.advanceTimersByTime(500)
  expect(view.plugin(searchHighlightPlugin)!.decorations.size).toBe(0)
  expect(cursor).toHaveBeenCalledTimes(2)
})
