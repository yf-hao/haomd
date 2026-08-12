import { useEffect, useMemo, useRef, useState, forwardRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { createExtensions, type EditorOptions } from './extensions'
import { useResolvedThemeMode } from '../../modules/theme/ThemeContext'

export type CodeEditorProps = {
  value: string
  onChange: (value: string) => void
  onCursorChange?: (line: number) => void
  readOnly?: boolean
  extensions?: Extension[]
  className?: string
  placeholder?: string
  onViewReady?: (view: EditorView | null) => void
  onFoldRegionsChange?: (regions: { fromLine: number; toLine: number }[]) => void
  editorZoom?: number
}

export const CodeEditor = forwardRef<HTMLDivElement, Readonly<CodeEditorProps>>(function CodeEditor(
  props,
  ref,
) {
  const { value, onChange, onCursorChange, readOnly, extensions, className, placeholder, onViewReady, onFoldRegionsChange, editorZoom } = props
  const themeMode = useResolvedThemeMode()
  const [editorValue, setEditorValue] = useState(value)
  const editorViewRef = useRef<EditorView | null>(null)
  const onViewReadyRef = useRef(onViewReady)
  const isComposingRef = useRef(false)
  const lastForwardedValueRef = useRef(value)
  const lastPropValueRef = useRef(value)
  const pendingExternalValueRef = useRef<string | null>(null)

  useEffect(() => {
    onViewReadyRef.current = onViewReady
  }, [onViewReady])

  useEffect(() => {
    return () => {
      editorViewRef.current = null
      onViewReadyRef.current?.(null)
    }
  }, [])

  useEffect(() => {
    if (value === lastPropValueRef.current) return
    lastPropValueRef.current = value

    const view = editorViewRef.current
    if (isComposingRef.current || view?.composing) {
      pendingExternalValueRef.current = value
      return
    }

    pendingExternalValueRef.current = null
    lastForwardedValueRef.current = value
    if (view && view.state.doc.toString() !== value) {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: value,
        },
      })
    }
    setEditorValue(value)
  }, [value])

  const forwardChange = (nextValue: string) => {
    if (nextValue === lastForwardedValueRef.current) return
    lastForwardedValueRef.current = nextValue
    onChange(nextValue)
  }

  const flushComposition = () => {
    queueMicrotask(() => {
      const view = editorViewRef.current
      if (!view || view.dom.isConnected === false) return
      const nextValue = view.state.doc.toString()
      setEditorValue(nextValue)
      forwardChange(nextValue)

      const pendingExternalValue = pendingExternalValueRef.current
      pendingExternalValueRef.current = null
      if (pendingExternalValue !== null && pendingExternalValue !== nextValue) {
        view.dispatch({
          changes: {
            from: 0,
            to: view.state.doc.length,
            insert: pendingExternalValue,
          },
        })
        setEditorValue(pendingExternalValue)
        lastForwardedValueRef.current = pendingExternalValue
      }
    })
  }

  const mergedExtensions = useMemo(() => {
    if (extensions && extensions.length) return extensions
    // 显式开启行号和当前行高亮，避免默认值被未来改动影响
    return createExtensions({
      onCursorChange,
      readOnly,
      onFoldRegionsChange,
      showLineNumbers: true,
      showActiveLine: true,
      themeMode,
    } as EditorOptions)
  }, [extensions, onCursorChange, readOnly, onFoldRegionsChange, themeMode])

  const zoom = editorZoom ?? 1.0
  const BASE_FONT = 14
  const BASE_GUTTER_FONT = 12
  const fontSizePx = BASE_FONT * zoom
  const gutterFontSizePx = BASE_GUTTER_FONT * zoom

  return (
    <div
      ref={ref}
      onCompositionStart={() => {
        isComposingRef.current = true
      }}
      onCompositionEnd={() => {
        isComposingRef.current = false
        flushComposition()
      }}
      className={className}
      style={{
        '--editor-font-size': `${fontSizePx}px`,
        '--editor-gutter-font-size': `${gutterFontSizePx}px`,
      } as React.CSSProperties}
    >
      <CodeMirror
        height="100%"
        basicSetup={false}
        theme={themeMode}
        className="cm-root"
        readOnly={readOnly}
        placeholder={placeholder}
        extensions={mergedExtensions}
        value={editorValue}
        onChange={(val) => {
          setEditorValue(val)
          if (!isComposingRef.current && !editorViewRef.current?.composing) {
            forwardChange(val)
          }
        }}
        onUpdate={(update) => {
          isComposingRef.current = update.view.compositionStarted
        }}
        onCreateEditor={(view) => {
          editorViewRef.current = view
          onViewReadyRef.current?.(view)
        }}
      />
    </div>
  )
})

export default CodeEditor
