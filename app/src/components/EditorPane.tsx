import { useEffect, type RefObject } from 'react'
import { EditorView } from '@codemirror/view'
import { CodeEditor } from './Editor/CodeEditor'
import './EditorPane.css'

export type EditorFocusRequest = {
  localLine: number
  searchText?: string
}

export type EditorPaneProps = {
  markdown: string
  onChange: (value: string) => void
  onCursorChange: (line: number) => void
  showPreview: boolean
  setShowPreview: (value: boolean | ((prev: boolean) => boolean)) => void
  editorViewRef: RefObject<EditorView | null>
  onFoldRegionsChange?: (regions: { fromLine: number; toLine: number }[]) => void
  focusRequest?: EditorFocusRequest | null
  onFocusHandled?: () => void
  onProgrammaticScrollStart?: () => void
  onProgrammaticScrollEnd?: () => void
  editorZoom: number
  onEditorReady?: () => void
}

export function EditorPane(props: EditorPaneProps) {
  const {
    markdown,
    onChange,
    onCursorChange,
    editorViewRef,
    onFoldRegionsChange,
    focusRequest,
    onFocusHandled,
    onProgrammaticScrollStart,
    onProgrammaticScrollEnd,
    editorZoom,
    onEditorReady,
  } = props

  useEffect(() => {
    if (!focusRequest) return
    const view = editorViewRef.current
    if (!view) return

    const doc = view.state.doc
    const docText = doc.toString()
    // 等待 CodeMirror 用最新 markdown 同步完文档
    if (docText !== markdown) return

    onProgrammaticScrollStart?.()

    const { localLine, searchText } = focusRequest
    let pos = 0

    if (searchText) {
      for (let i = 1; i <= doc.lines; i++) {
        const l = doc.line(i)
        if (l.text.includes(searchText)) {
          pos = l.from
          break
        }
      }
    }

    if (!pos) {
      const safeLine = localLine > 0 ? Math.min(localLine, doc.lines) : 1
      pos = doc.line(safeLine).from
    }

    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'center' }),
      scrollIntoView: true,
    })

    onFocusHandled?.()
    onProgrammaticScrollEnd?.()
  }, [focusRequest, editorViewRef, onFocusHandled, onProgrammaticScrollStart, onProgrammaticScrollEnd, markdown])

  return (
    <CodeEditor
      value={markdown}
      onChange={onChange}
      onCursorChange={onCursorChange}
      placeholder="在此输入 Markdown..."
      className="code-editor"
      editorZoom={editorZoom}
      onViewReady={(view) => {
        editorViewRef.current = view
        onEditorReady?.()
      }}
      onFoldRegionsChange={onFoldRegionsChange}
    />
  )
}
