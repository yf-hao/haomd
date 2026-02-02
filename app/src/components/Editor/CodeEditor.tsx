import { useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { createExtensions, type EditorOptions } from './extensions'

export type CodeEditorProps = {
  value: string
  onChange: (value: string) => void
  onCursorChange?: (line: number) => void
  readOnly?: boolean
  extensions?: Extension[]
  className?: string
  placeholder?: string
  onViewReady?: (view: EditorView) => void
}

export function CodeEditor(props: Readonly<CodeEditorProps>) {
  const { value, onChange, onCursorChange, readOnly, extensions, className, placeholder, onViewReady } = props

  const mergedExtensions = useMemo(() => {
    if (extensions && extensions.length) return extensions
    return createExtensions({ onCursorChange, readOnly } as EditorOptions)
  }, [extensions, onCursorChange, readOnly])

  return (
    <CodeMirror
      value={value}
      height="100%"
      basicSetup={false}
      theme="dark"
      className={className}
      readOnly={readOnly}
      placeholder={placeholder}
      extensions={mergedExtensions}
      onChange={(val) => onChange(val)}
      onCreateEditor={(view) => {
        onViewReady?.(view)
      }}
    />
  )
}

export default CodeEditor
