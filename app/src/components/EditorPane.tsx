import type { RefObject } from 'react'
import type { EditorView } from '@codemirror/view'
import { CodeEditor } from './Editor/CodeEditor'

export type EditorPaneProps = {
  markdown: string
  onChange: (value: string) => void
  onCursorChange: (line: number) => void
  showPreview: boolean
  setShowPreview: (value: boolean | ((prev: boolean) => boolean)) => void
  editorViewRef: RefObject<EditorView | null>
}

export function EditorPane({
  markdown,
  onChange,
  onCursorChange,
  showPreview,
  setShowPreview,
  editorViewRef,
}: EditorPaneProps) {
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
    />
  )
}
