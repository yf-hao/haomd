import type { RefObject } from 'react'
import type { EditorView } from '@codemirror/view'
import { CodeEditor } from './Editor/CodeEditor'
import './EditorPane.css'

export type EditorPaneProps = {
  markdown: string
  onChange: (value: string) => void
  onCursorChange: (line: number) => void
  showPreview: boolean
  setShowPreview: (value: boolean | ((prev: boolean) => boolean)) => void
  editorViewRef: RefObject<EditorView | null>
  onFoldRegionsChange?: (regions: { fromLine: number; toLine: number }[]) => void
}

export function EditorPane(props: EditorPaneProps) {
  const { markdown, onChange, onCursorChange, editorViewRef, onFoldRegionsChange } = props
  return (
    <CodeEditor
      value={markdown}
      onChange={onChange}
      onCursorChange={onCursorChange}
      placeholder="在此输入 Markdown..."
      className="code-editor"
      onViewReady={(view) => {
        editorViewRef.current = view
      }}
      onFoldRegionsChange={onFoldRegionsChange}
    />
  )
}
