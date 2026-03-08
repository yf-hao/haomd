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
  onFoldRegionsChange?: (regions: { fromLine: number; toLine: number }[]) => void
  editorZoom?: number
}

export function CodeEditor(props: Readonly<CodeEditorProps>) {
  const { value, onChange, onCursorChange, readOnly, extensions, className, placeholder, onViewReady, onFoldRegionsChange, editorZoom } = props

  const mergedExtensions = useMemo(() => {
    if (extensions && extensions.length) return extensions
    // 显式开启行号和当前行高亮，避免默认值被未来改动影响
    return createExtensions({
      onCursorChange,
      readOnly,
      onFoldRegionsChange,
      showLineNumbers: true,
      showActiveLine: true,
    } as EditorOptions)
  }, [extensions, onCursorChange, readOnly, onFoldRegionsChange])

  const zoom = editorZoom ?? 1.0
  const BASE_FONT = 14
  const BASE_GUTTER_FONT = 12
  const fontSizePx = BASE_FONT * zoom
  const gutterFontSizePx = BASE_GUTTER_FONT * zoom

  return (
    <div
      className={className}
      style={{
        '--haomd-editor-font-size': `${fontSizePx}px`,
        '--haomd-editor-gutter-font-size': `${gutterFontSizePx}px`,
      } as React.CSSProperties}
    >
      <CodeMirror
        value={value}
        height="100%"
        basicSetup={false}
        theme="dark"
        className="cm-root"
        readOnly={readOnly}
        placeholder={placeholder}
        extensions={mergedExtensions}
        onChange={(val) => onChange(val)}
        onCreateEditor={(view) => {
          onViewReady?.(view)
        }}
      />
    </div>
  )
}

export default CodeEditor
