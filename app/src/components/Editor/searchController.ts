import {
  findNext,
  findPrevious,
  replaceAll,
  replaceNext,
  SearchQuery,
  setSearchQuery,
} from '@codemirror/search'
import type { EditorView as CodeMirrorEditorView } from '@codemirror/view'
import { TextSelection } from '@milkdown/prose/state'
import type { EditorView as ProseMirrorEditorView } from '@milkdown/prose/view'
import { setCustomSearchQuery } from './searchHighlight'

export type SearchOptions = {
  searchText: string
  caseSensitive: boolean
  wholeWord: boolean
  regexp: boolean
}

export type SearchResult = {
  matchCount: number
  currentMatchIndex: number
}

export interface SearchController {
  getInitialSearchText: () => string
  apply: (options: SearchOptions) => SearchResult
  navigate: (direction: 'next' | 'prev', options: SearchOptions) => SearchResult
  replace: (options: SearchOptions, replacement: string, all: boolean) => SearchResult
  clear: () => void
}

type TextMatch = {
  from: number
  to: number
  text: string
}

function emptyResult(): SearchResult {
  return { matchCount: 0, currentMatchIndex: 0 }
}

function getCurrentMatchIndex(matches: TextMatch[], head: number): number {
  if (matches.length === 0) return 0
  const index = matches.findIndex((match) => (
    match.from >= head || (match.from < head && match.to >= head)
  ))
  return index >= 0 ? index + 1 : matches.length
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function createSearchRegExp(options: SearchOptions, global: boolean): RegExp | null {
  if (!options.searchText) return null

  let source = options.regexp ? options.searchText : escapeRegExp(options.searchText)
  if (options.wholeWord) {
    source = `\\b(?:${source})\\b`
  }

  try {
    return new RegExp(source, `${options.caseSensitive ? '' : 'i'}${global ? 'g' : ''}`)
  } catch {
    return null
  }
}

function findStringMatches(text: string, options: SearchOptions): TextMatch[] {
  const regexp = createSearchRegExp(options, true)
  if (!regexp) return []

  return Array.from(text.matchAll(regexp)).map((match) => {
    const from = match.index ?? 0
    return {
      from,
      to: from + match[0].length,
      text: match[0],
    }
  })
}

function getReplacementText(match: string, options: SearchOptions, replacement: string): string {
  if (!options.regexp) return replacement
  const regexp = createSearchRegExp(options, false)
  return regexp ? match.replace(regexp, replacement) : replacement
}

function getCodeMirrorMatches(view: CodeMirrorEditorView, options: SearchOptions): TextMatch[] {
  if (!options.searchText) return []

  const query = new SearchQuery({
    search: options.searchText,
    caseSensitive: options.caseSensitive,
    regexp: options.regexp,
    replace: '',
    wholeWord: options.wholeWord,
  })
  const cursor = query.getCursor(view.state) as {
    next: () => IteratorResult<{ from: number; to: number }>
  }
  const matches: TextMatch[] = []

  while (true) {
    const next = cursor.next()
    if (next.done) break
    matches.push({
      from: next.value.from,
      to: next.value.to,
      text: view.state.sliceDoc(next.value.from, next.value.to),
    })
  }

  return matches
}

function getCodeMirrorResult(view: CodeMirrorEditorView, options: SearchOptions): SearchResult {
  const matches = getCodeMirrorMatches(view, options)
  return {
    matchCount: matches.length,
    currentMatchIndex: getCurrentMatchIndex(matches, view.state.selection.main.head),
  }
}

export function createCodeMirrorSearchController(view: CodeMirrorEditorView): SearchController {
  const applyQuery = (options: SearchOptions) => {
    const query = new SearchQuery({
      search: options.searchText,
      caseSensitive: options.caseSensitive,
      regexp: options.regexp,
      replace: '',
      wholeWord: options.wholeWord,
    })
    view.dispatch({
      effects: [
        setSearchQuery.of(query),
        setCustomSearchQuery.of(query),
      ],
    })
  }

  return {
    getInitialSearchText: () => {
      const selection = view.state.selection.main
      return selection.empty ? '' : view.state.sliceDoc(selection.from, selection.to)
    },
    apply: (options) => {
      applyQuery(options)
      return getCodeMirrorResult(view, options)
    },
    navigate: (direction, options) => {
      if (!options.searchText) return emptyResult()
      applyQuery(options)

      if (direction === 'next') {
        findNext(view)
      } else {
        const matches = getCodeMirrorMatches(view, options)
        const head = view.state.selection.main.head
        const currentIndex = matches.findIndex((match) => (
          match.from < head && match.to >= head
        ))
        if (currentIndex >= 0) {
          view.dispatch({ selection: { anchor: matches[currentIndex].from } })
        }
        findPrevious(view)
      }

      const selection = view.state.selection.main
      if (!selection.empty) {
        const targetPos = selection.to
        view.dispatch({
          selection: { anchor: targetPos, head: targetPos },
          scrollIntoView: true,
          userEvent: 'select.search',
        })
      }

      return getCodeMirrorResult(view, options)
    },
    replace: (options, replacement, all) => {
      if (!options.searchText) return emptyResult()
      const query = new SearchQuery({
        search: options.searchText,
        caseSensitive: options.caseSensitive,
        regexp: options.regexp,
        replace: replacement,
        wholeWord: options.wholeWord,
      })
      view.dispatch({ effects: setSearchQuery.of(query) })
      if (all) {
        replaceAll(view)
      } else {
        replaceNext(view)
      }
      return getCodeMirrorResult(view, options)
    },
    clear: () => {
      view.dispatch({
        effects: [
          setSearchQuery.of(new SearchQuery({ search: '' })),
          setCustomSearchQuery.of(null),
        ],
      })
    },
  }
}

type ProseMirrorTextSegment = {
  from: number
  flatStart: number
  flatEnd: number
}

type ProseMirrorTextSnapshot = {
  text: string
  segments: ProseMirrorTextSegment[]
}

function getProseMirrorTextSnapshot(view: ProseMirrorEditorView): ProseMirrorTextSnapshot {
  let text = ''
  const segments: ProseMirrorTextSegment[] = []

  view.state.doc.forEach((child, offset, index) => {
    if (index > 0) text += '\n'
    child.descendants((node, position) => {
      if (!node.isText || !node.text) return
      const flatStart = text.length
      text += node.text
      segments.push({
        from: offset + 1 + position,
        flatStart,
        flatEnd: text.length,
      })
    })
  })

  return { text, segments }
}

function mapFlatOffsetToProseMirrorPosition(
  segments: ProseMirrorTextSegment[],
  offset: number,
): number | null {
  for (const segment of segments) {
    if (offset >= segment.flatStart && offset <= segment.flatEnd) {
      return segment.from + Math.min(offset - segment.flatStart, segment.flatEnd - segment.flatStart)
    }
  }
  return null
}

function getProseMirrorMatches(
  view: ProseMirrorEditorView,
  options: SearchOptions,
): TextMatch[] {
  const snapshot = getProseMirrorTextSnapshot(view)
  return findStringMatches(snapshot.text, options)
    .map((match) => {
      const from = mapFlatOffsetToProseMirrorPosition(snapshot.segments, match.from)
      const to = mapFlatOffsetToProseMirrorPosition(snapshot.segments, match.to)
      if (from === null || to === null || to < from) return null
      return { ...match, from, to }
    })
    .filter((match): match is TextMatch => match !== null)
}

function getProseMirrorResult(view: ProseMirrorEditorView, options: SearchOptions): SearchResult {
  const matches = getProseMirrorMatches(view, options)
  return {
    matchCount: matches.length,
    currentMatchIndex: getCurrentMatchIndex(matches, view.state.selection.head),
  }
}

function selectProseMirrorMatch(view: ProseMirrorEditorView, match: TextMatch) {
  view.dispatch(
    view.state.tr
      .setSelection(TextSelection.create(view.state.doc, match.from, match.to))
      .scrollIntoView(),
  )
  view.focus()
}

export function createProseMirrorSearchController(
  view: ProseMirrorEditorView,
  onBeforeReplace?: () => void,
): SearchController {
  return {
    getInitialSearchText: () => {
      const { from, to } = view.state.selection
      return from === to ? '' : view.state.doc.textBetween(from, to, '\n', '\ufffc')
    },
    apply: (options) => getProseMirrorResult(view, options),
    navigate: (direction, options) => {
      const matches = getProseMirrorMatches(view, options)
      if (matches.length === 0) return emptyResult()

      const head = view.state.selection.head
      const selectionIsEmpty = view.state.selection.empty
      const currentIndex = matches.findIndex((match) => (
        match.from < head && match.to >= head
      ))
      let targetIndex: number
      if (direction === 'next') {
        targetIndex = matches.findIndex((match) => (
          selectionIsEmpty ? match.from >= head : match.from > head
        ))
        if (targetIndex < 0) targetIndex = 0
      } else if (currentIndex >= 0) {
        targetIndex = (currentIndex - 1 + matches.length) % matches.length
      } else {
        targetIndex = -1
        for (let index = matches.length - 1; index >= 0; index -= 1) {
          if (matches[index].to <= head) {
            targetIndex = index
            break
          }
        }
        if (targetIndex < 0) targetIndex = matches.length - 1
      }

      selectProseMirrorMatch(view, matches[targetIndex])
      return getProseMirrorResult(view, options)
    },
    replace: (options, replacement, all) => {
      const matches = getProseMirrorMatches(view, options)
      if (matches.length === 0) return emptyResult()

      onBeforeReplace?.()
      const targets = all
        ? matches
        : [matches.find((match) => (
          match.from < view.state.selection.head && match.to >= view.state.selection.head
        )) ?? matches[0]]
      const transaction = view.state.tr
      for (let index = targets.length - 1; index >= 0; index -= 1) {
        const match = targets[index]
        transaction.insertText(getReplacementText(match.text, options, replacement), match.from, match.to)
      }
      view.dispatch(transaction)
      view.focus()
      return getProseMirrorResult(view, options)
    },
    clear: () => {},
  }
}

export function createTextareaSearchController(textarea: HTMLTextAreaElement): SearchController {
  const getOptionsMatches = (options: SearchOptions) => findStringMatches(textarea.value, options)

  const getResult = (options: SearchOptions): SearchResult => {
    const matches = getOptionsMatches(options)
    return {
      matchCount: matches.length,
      currentMatchIndex: getCurrentMatchIndex(matches, textarea.selectionEnd ?? 0),
    }
  }

  const notifyInput = () => {
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  }

  return {
    getInitialSearchText: () => {
      const from = textarea.selectionStart ?? 0
      const to = textarea.selectionEnd ?? 0
      return from === to ? '' : textarea.value.slice(from, to)
    },
    apply: getResult,
    navigate: (direction, options) => {
      const matches = getOptionsMatches(options)
      if (matches.length === 0) return emptyResult()

      const head = textarea.selectionEnd ?? 0
      const selectionIsEmpty = textarea.selectionStart === textarea.selectionEnd
      const currentIndex = matches.findIndex((match) => (
        match.from < head && match.to >= head
      ))
      let targetIndex: number
      if (direction === 'next') {
        targetIndex = matches.findIndex((match) => (
          selectionIsEmpty ? match.from >= head : match.from > head
        ))
        if (targetIndex < 0) targetIndex = 0
      } else if (currentIndex >= 0) {
        targetIndex = (currentIndex - 1 + matches.length) % matches.length
      } else {
        targetIndex = -1
        for (let index = matches.length - 1; index >= 0; index -= 1) {
          if (matches[index].to <= head) {
            targetIndex = index
            break
          }
        }
        if (targetIndex < 0) targetIndex = matches.length - 1
      }

      const target = matches[targetIndex]
      textarea.focus()
      textarea.setSelectionRange(target.from, target.to)
      return getResult(options)
    },
    replace: (options, replacement, all) => {
      const matches = getOptionsMatches(options)
      if (matches.length === 0) return emptyResult()

      const targets = all
        ? matches
        : [matches.find((match) => (
          match.from < (textarea.selectionEnd ?? 0) &&
          match.to >= (textarea.selectionEnd ?? 0)
        )) ?? matches[0]]
      for (let index = targets.length - 1; index >= 0; index -= 1) {
        const match = targets[index]
        textarea.setRangeText(
          getReplacementText(match.text, options, replacement),
          match.from,
          match.to,
          'end',
        )
      }
      notifyInput()
      return getResult(options)
    },
    clear: () => {},
  }
}
