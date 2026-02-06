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
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { indentOnInput } from '@codemirror/language'
import { closeBrackets, autocompletion } from '@codemirror/autocomplete'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'

export type EditorOptions = {
  readOnly?: boolean
  showLineNumbers?: boolean
  showActiveLine?: boolean
  enableAutocomplete?: boolean
  onCursorChange?: (line: number) => void
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
      borderRight: '1px solid rgba(255, 255, 255, 0.04)',
      fontSize: '12px',
      // padding: '0px 5px 0px 5px',
      margin: 0,
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'rgba(98, 195, 255, 0.1)',
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
          if (update.selectionSet || update.docChanged) {
            this.reportLine(update.view)
          }
        }

        private reportLine(view: EditorView) {
          const pos = view.state.selection.main.head
          const line = view.state.doc.lineAt(pos).number
          // 调试：输出 CodeMirror 内部计算的行号
          console.log('[Editor] cursor line =', line)
          if (line !== this.lastLine) {
            this.lastLine = line
            onCursorChange(line)
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

export function createExtensions(options: EditorOptions = {}): Extension[] {
  const {
    readOnly = false,
    showLineNumbers = true,
    showActiveLine = true,
    enableAutocomplete = true,
    onCursorChange,
  } = options

  const language = markdown()

  const extensions: Extension[] = [
    oneDark,
    baseTheme,
    EditorState.tabSize.of(2),
    drawSelection(),
    indentOnInput(),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    smartScrollOnInputPlugin(),
    language,
    EditorView.editable.of(!readOnly),
  ]

  if (showLineNumbers) extensions.unshift(lineNumbers())
  if (showActiveLine) extensions.push(highlightActiveLine(), highlightActiveLineGutter())
  if (enableAutocomplete) extensions.push(closeBrackets(), autocompletion())
  extensions.push(...cursorSyncPlugin(onCursorChange))

  return extensions
}
