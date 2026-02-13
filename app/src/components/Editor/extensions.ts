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

export type EditorOptions = {
  readOnly?: boolean
  showLineNumbers?: boolean
  showActiveLine?: boolean
  enableAutocomplete?: boolean
  onCursorChange?: (line: number) => void
  onFoldRegionsChange?: (regions: { fromLine: number; toLine: number }[]) => void
}

const baseTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'transparent',
      color: '#e8ecf5',
      fontFamily:
        "'JetBrains Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
      fontSize: '14px',
    },
    '.cm-content': {
      caretColor: '#7ad7ff',
      padding: '12px 14px 12px 14px',
    },
    '.cm-gutters': {
      backgroundColor: 'rgba(5, 6, 10, 0.9) !important ',
      color: '#8fa1c7',
      borderRight: 'none',
      fontSize: '12px',
      // padding: '0px 5px 0px 5px',
      margin: 0,
    },
    // 光标所在行：所有 gutter 的 active 单元格统一高亮背景
    '.cm-gutter .cm-activeLineGutter': {
      backgroundColor: 'rgba(98, 195, 255, 0.1)',
    },
    // 光标所在行：折叠 gutter（cm-foldGutter）这一列的右侧画绿色竖线
    '.cm-gutter.cm-foldGutter .cm-activeLineGutter': {
      borderRight: '2px solid #22c55e',
    },
    '.cm-line': {
      paddingLeft: '6px',
    },
    '.cm-scroller': {
      lineHeight: '1.6',
      padding: 0,
      // 在文档末尾预留一段“虚拟空白”，避免最后一行贴着底部
      paddingBottom: '25vh',
    },
    '&.cm-editor.cm-focused': {
      outline: 'none',
    },
  },
  { dark: true },
)

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

// 在输入内容时，使用 CodeMirror 自带的 scrollIntoView 效果，避免光标贴在底部
function smartScrollOnInputPlugin(): Extension {
  return EditorView.updateListener.of((update) => {
    if (!update.docChanged) return

    const head = update.state.selection.main.head

    // 使用官方的滚动效果，把光标位置滚动到视窗的中部附近
    update.view.dispatch({
      effects: EditorView.scrollIntoView(head, { y: 'center' }),
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

export function createExtensions(options: EditorOptions = {}): Extension[] {
  const {
    readOnly = false,
    showLineNumbers = true,
    showActiveLine = true,
    enableAutocomplete = true,
    onCursorChange,
    onFoldRegionsChange,
  } = options

  const language = markdown()

  const filteredDefaultKeymap = defaultKeymap.filter((binding) => binding.run !== deleteLine)

  const customKeymap = [
    {
      key: 'Mod-Shift-d',
      run: deleteLine,
    },
  ]

  const extensions: Extension[] = [
    oneDark,
    baseTheme,
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
    smartScrollOnInputPlugin(),
    language,
    EditorView.editable.of(!readOnly),
  ]

  if (showLineNumbers) extensions.unshift(lineNumbers(), foldGutter())
  if (showActiveLine) extensions.push(highlightActiveLine(), highlightActiveLineGutter())
  if (enableAutocomplete) extensions.push(closeBrackets(), autocompletion())
  extensions.push(...cursorSyncPlugin(onCursorChange))
  extensions.push(...foldRegionsPlugin(onFoldRegionsChange))

  return extensions
}
