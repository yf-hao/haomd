import type { Extension } from '@codemirror/state'
import { EditorState } from '@codemirror/state'
import {
  EditorView,
  keymap,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  lineNumbers,
  ViewPlugin,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, deleteLine } from '@codemirror/commands'
import { indentOnInput, foldGutter, foldKeymap, foldedRanges } from '@codemirror/language'
import { closeBrackets, autocompletion } from '@codemirror/autocomplete'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { search } from '@codemirror/search'
import { customSearchHighlight } from './searchHighlight'
import type { ResolvedThemeMode } from '../../modules/theme/themeRuntime'

export type EditorOptions = {
  readOnly?: boolean
  showLineNumbers?: boolean
  showActiveLine?: boolean
  enableAutocomplete?: boolean
  themeMode?: ResolvedThemeMode
  onCursorChange?: (line: number) => void
  onFoldRegionsChange?: (regions: { fromLine: number; toLine: number }[]) => void
}

function createBaseTheme(themeMode: ResolvedThemeMode) {
  return EditorView.theme(
    {
      '&': {
        backgroundColor: 'transparent',
        color: 'var(--theme-text-default)',
        fontFamily:
          "'JetBrains Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
        fontSize: 'var(--ui-font-editor)',
      },
      '.cm-activeLine': {
        backgroundColor: 'transparent',
      },
      '.cm-content': {
        caretColor: 'var(--theme-editor-caret)',
        padding: '12px 14px 12px 14px',
        flex: '1 1 0',
        minHeight: '100%',
        paddingBottom: '25vh',
      },
      '.cm-gutters': {
        backgroundColor: 'var(--theme-surface-editor-gutter)',
        color: 'var(--theme-editor-gutter-fg)',
        borderRight: 'none',
        fontSize: 'calc(var(--ui-font-editor) - 2px)',
        margin: 0,
      },
      '.cm-gutter .cm-activeLineGutter': {
        backgroundColor: 'var(--theme-editor-active-gutter-bg)',
        position: 'relative',
      },
      '.cm-lineNumbers .cm-activeLineGutter::after': {
        content: '""',
        position: 'absolute',
        top: 0,
        bottom: 0,
        right: '0px',
        width: '2px',
        backgroundColor: 'var(--theme-editor-active-line-marker)',
        boxShadow: '0 0 8px var(--theme-editor-active-line-marker)',
        pointerEvents: 'none',
      },
      '.cm-line': {
        paddingLeft: '6px',
      },
      '.cm-scroller': {
        backgroundColor: 'transparent',
        lineHeight: '1.6',
        padding: 0,
      },
      '&.cm-editor.cm-focused': {
        outline: 'none',
      },
    },
    { dark: themeMode === 'dark' },
  )
}

function cursorSyncPlugin(onCursorChange?: (line: number) => void): Extension[] {
  if (!onCursorChange) return []
  return [
    ViewPlugin.fromClass(
      class {
        private lastLine: number | null = null

        constructor(view: EditorView) {
          this.reportLine(view)
        }

        update(update: { view: EditorView; selectionSet?: boolean; docChanged?: boolean }) {
          const { view, selectionSet, docChanged } = update
          const main = view.state.selection.main
          const hasRange = !main.empty

          // 只在文档变更或光标位置变化时回调，避免拖选多行时高频调用
          if (docChanged || (selectionSet && !hasRange)) {
            this.reportLine(view)
          }
        }

        private reportLine(view: EditorView) {
          const pos = view.state.selection.main.head
          const line = view.state.doc.lineAt(pos).number
          const safeLine = Math.max(1, line)
          if (safeLine !== this.lastLine) {
            this.lastLine = safeLine
            onCursorChange(safeLine)
          }
        }
      },
    ),
  ]
}

// 防止浏览器 contenteditable 焦点跟随导致 overflow:hidden 祖先容器被滚动。
// 在 CM 编辑器挂载后，监听从 .cm-scroller 到 document 的所有祖先元素的 scroll 事件，
// 对非 .cm-scroller 的容器立即重置 scrollTop/scrollLeft。
function ancestorScrollGuardPlugin(): Extension {
  return ViewPlugin.fromClass(class {
    private cleanups: (() => void)[] = []

    constructor(view: EditorView) {
      // 延迟一帧，确保 DOM 已经完成挂载
      requestAnimationFrame(() => this.attach(view))
    }

    private attach(view: EditorView) {
      const scroller = view.scrollDOM
      let el: HTMLElement | null = scroller.parentElement
      while (el) {
        const target = el
        const handler = () => {
          if (target.scrollTop !== 0 || target.scrollLeft !== 0) {
            target.scrollTop = 0
            target.scrollLeft = 0
          }
        }
        target.addEventListener('scroll', handler)
        this.cleanups.push(() => target.removeEventListener('scroll', handler))
        el = el.parentElement
      }
    }

    destroy() {
      for (const fn of this.cleanups) fn()
      this.cleanups.length = 0
    }
  })
}

// 在输入内容时，仅在「回车产生换行」时才触发滚动，避免每个字符输入都触发布局。
// 直接调整 .cm-scroller 的 scrollTop 而非使用 EditorView.scrollIntoView，
// 后者会触发浏览器原生的 focus-scroll 级联，导致 overflow:hidden 祖先容器被滚动。
function smartScrollOnInputPlugin(): Extension {
  return EditorView.updateListener.of((update: any) => {
    if (!update.docChanged) return

    // 检查本次变更是否插入了换行符（回车 / 粘贴带换行）
    let insertedNewline = false
    try {
      update.changes.iterChanges(
        (_fromA: number, _toA: number, _fromB: number, _toB: number, inserted: any) => {
          if (String(inserted) && String(inserted).includes('\n')) {
            insertedNewline = true
          }
        },
      )
    } catch {
      insertedNewline = true
    }

    if (!insertedNewline) return

    const view = update.view
    const head = update.state.selection.main.head
    const scroller = view.scrollDOM

    requestAnimationFrame(() => {
      try {
        const coords = view.coordsAtPos(head)
        if (!coords) return
        const rect = scroller.getBoundingClientRect()
        const topGap = coords.top - rect.top
        const bottomGap = coords.bottom - rect.bottom

        if (topGap < 0) {
          scroller.scrollTop += topGap - 16
        } else if (bottomGap > 0) {
          scroller.scrollTop += bottomGap + 16
        }
      } catch { /* position may be stale */ }

      // 重置祖先 overflow:hidden 容器的意外滚动偏移
      let el: HTMLElement | null = scroller.parentElement as HTMLElement | null
      while (el) {
        if (el.scrollTop !== 0 || el.scrollLeft !== 0) {
          el.scrollTop = 0
          el.scrollLeft = 0
        }
        el = el.parentElement as HTMLElement | null
      }
    })
  })
}

function foldRegionsPlugin(onFoldRegionsChange?: (regions: { fromLine: number; toLine: number }[]) => void): Extension[] {
  if (!onFoldRegionsChange) return []

  return [
    ViewPlugin.fromClass(
      class {
        private lastRegionsJson = ''
        private view: EditorView

        constructor(view: EditorView) {
          this.view = view
          this.reportRegions()
        }

        update(update: { view: EditorView; docChanged?: boolean }) {
          // 这里只在文档实际发生变更时重新统计折叠区域，
          // 避免在光标移动或拖选多行时每次都做一次完整扫描。
          if (!update.docChanged) return
          this.view = update.view
          this.reportRegions()
        }

        private reportRegions() {
          const state = this.view.state
          const regions: { fromLine: number; toLine: number }[] = []

          try {
            const ranges = foldedRanges(state)
            ranges.between(0, state.doc.length, (from, to) => {
              const fromLine = state.doc.lineAt(from).number
              const toLine = state.doc.lineAt(to).number
              regions.push({ fromLine, toLine })
            })
          } catch {
            // 某些环境下如果 foldedRanges 不可用，就直接跳过，不影响编辑器本身行为
            return
          }

          const json = JSON.stringify(regions)
          if (json === this.lastRegionsJson) return
          this.lastRegionsJson = json
          onFoldRegionsChange(regions)
        }
      },
    ),
  ]
}

type SourceLine = {
  from: number
  to: number
  content: string
}

type MathFormulaRange = {
  from: number
  to: number
}

function splitSourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = []
  let from = 0

  while (from <= source.length) {
    const newline = source.indexOf('\n', from)
    const to = newline === -1 ? source.length : newline
    lines.push({ from, to, content: source.slice(from, to) })
    if (newline === -1) break
    from = newline + 1
  }

  return lines
}

function isEscaped(source: string, position: number): boolean {
  let backslashCount = 0
  for (let index = position - 1; index >= 0 && source[index] === '\\'; index -= 1) {
    backslashCount += 1
  }
  return backslashCount % 2 === 1
}

function getFencedCodeLineIndexes(lines: SourceLine[]): Set<number> {
  const fencedLines = new Set<number>()
  let activeFence: { marker: '`' | '~'; length: number } | null = null

  lines.forEach((line, index) => {
    const fenceMatch = /^[ \t]*(`{3,}|~{3,})/.exec(line.content)

    if (activeFence) {
      fencedLines.add(index)
      if (
        fenceMatch &&
        fenceMatch[1]![0] === activeFence.marker &&
        fenceMatch[1]!.length >= activeFence.length
      ) {
        activeFence = null
      }
      return
    }

    if (!fenceMatch) return
    fencedLines.add(index)
    activeFence = {
      marker: fenceMatch[1]![0] as '`' | '~',
      length: fenceMatch[1]!.length,
    }
  })

  return fencedLines
}

function findEmptyDisplayFormula(
  source: string,
  lines: SourceLine[],
  fencedLines: Set<number>,
  position: number,
): MathFormulaRange | null {
  for (let index = 0; index < lines.length; index += 1) {
    if (fencedLines.has(index)) continue
    const line = lines[index]!
    const trimmed = line.content.trim()
    const leadingWhitespace = line.content.length - line.content.trimStart().length
    const formulaFrom = line.from + leadingWhitespace

    if (/^\$\$[ \t]*\$\$$/.test(trimmed)) {
      const openingEnd = formulaFrom + 2
      const closingStart = formulaFrom + trimmed.length - 2
      if (position >= openingEnd && position <= closingStart) {
        return {
          from: line.from,
          to: line.to < source.length ? line.to + 1 : line.to,
        }
      }
    }

    if (trimmed !== '$$') continue

    for (let closingIndex = index + 1; closingIndex < lines.length; closingIndex += 1) {
      if (fencedLines.has(closingIndex)) break
      const closingLine = lines[closingIndex]!
      const closingTrimmed = closingLine.content.trim()

      if (closingTrimmed === '$$') {
        const contentFrom = line.to
        const contentTo = closingLine.from
        if (position >= contentFrom && position <= contentTo) {
          return {
            from: line.from,
            to: closingLine.to < source.length ? closingLine.to + 1 : closingLine.to,
          }
        }
        break
      }

      if (closingTrimmed !== '') break
    }
  }

  return null
}

function isSingleDollarDelimiter(source: string, position: number, line: SourceLine): boolean {
  if (source[position] !== '$' || isEscaped(source, position)) return false
  return source[position - 1] !== '$' && source[position + 1] !== '$' &&
    position >= line.from && position < line.to
}

function findEmptyInlineFormula(
  source: string,
  line: SourceLine,
  fencedLines: Set<number>,
  lineIndex: number,
  position: number,
): MathFormulaRange | null {
  if (fencedLines.has(lineIndex)) return null

  let opening = -1
  for (let index = line.from; index < line.to; index += 1) {
    if (!isSingleDollarDelimiter(source, index, line)) continue

    if (opening === -1) {
      opening = index
      continue
    }

    if (
      source.slice(opening + 1, index).trim() === '' &&
      position >= opening + 1 &&
      position <= index
    ) {
      return { from: opening, to: index + 1 }
    }
    opening = -1
  }

  return null
}

export function deleteEmptyMathFormula(view: EditorView): boolean {
  const { state } = view
  const selection = state.selection.main
  if (state.readOnly || state.selection.ranges.length !== 1 || !selection.empty) return false

  const source = state.doc.toString()
  const lines = splitSourceLines(source)
  const lineIndex = lines.findIndex((line) => selection.from >= line.from && selection.from <= line.to)
  if (lineIndex === -1) return false

  const fencedLines = getFencedCodeLineIndexes(lines)
  const range =
    findEmptyDisplayFormula(source, lines, fencedLines, selection.from) ??
    findEmptyInlineFormula(source, lines[lineIndex]!, fencedLines, lineIndex, selection.from)
  if (!range) return false

  view.dispatch({
    changes: range,
    selection: { anchor: range.from },
    scrollIntoView: true,
    userEvent: 'delete.forward',
  })
  return true
}

export function createExtensions(options: EditorOptions = {}): Extension[] {
  const {
    readOnly = false,
    showLineNumbers = true,
    showActiveLine = true,
    enableAutocomplete = true,
    themeMode = 'dark',
    onCursorChange,
    onFoldRegionsChange,
  } = options

  const language = markdown()

  const filteredDefaultKeymap = defaultKeymap.filter((binding) => binding.run !== deleteLine)

  const customKeymap = [
    {
      key: 'Delete',
      run: deleteEmptyMathFormula,
    },
    {
      key: 'Mod-Shift-d',
      run: deleteLine,
    },
    {
      // Shift+4 types '$'. When there's a selection, wrap it with $...$
      key: '$',
      run: (view: EditorView): boolean => {
        const { state } = view
        const { from, to } = state.selection.main
        if (from === to) return false // no selection — let default input handle it
        const selected = state.doc.sliceString(from, to)
        const wrapped = `$${selected}$`
        view.dispatch(state.update({
          changes: { from, to, insert: wrapped },
          selection: { anchor: from + wrapped.length },
          scrollIntoView: true,
          userEvent: 'input',
        }))
        return true
      },
    },
  ]

  const extensions: Extension[] = [
    createBaseTheme(themeMode),
    EditorState.tabSize.of(2),
    drawSelection(),
    indentOnInput(),
    history(),
    keymap.of([
      ...customKeymap,
      ...filteredDefaultKeymap,
      ...historyKeymap,
      ...foldKeymap,
    ] as any),
    EditorView.lineWrapping,
    ancestorScrollGuardPlugin(),
    smartScrollOnInputPlugin(),
    search(), // 启用搜索逻辑
    customSearchHighlight(), // 自定义独立的高亮重绘层，彻底解决依赖冲突和样式被盖问题
    language,
    EditorView.editable.of(!readOnly),
  ]

  if (themeMode === 'dark') {
    extensions.unshift(oneDark)
  }

  if (showLineNumbers) extensions.unshift(lineNumbers(), foldGutter())
  if (showActiveLine) extensions.push(highlightActiveLine(), highlightActiveLineGutter())
  if (enableAutocomplete) extensions.push(closeBrackets(), autocompletion())
  extensions.push(...cursorSyncPlugin(onCursorChange))
  extensions.push(...foldRegionsPlugin(onFoldRegionsChange))

  return extensions
}
