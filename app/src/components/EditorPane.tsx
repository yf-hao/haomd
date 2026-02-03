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
    <>
      <button
        className="floating-toggle"
        aria-label={showPreview ? '隐藏预览' : '显示预览'}
        onClick={() => setShowPreview((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setShowPreview((v) => !v)
          }
        }}
      >
        {showPreview ? '隐藏预览' : '显示预览'}
      </button>
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
    </>
  )
}
