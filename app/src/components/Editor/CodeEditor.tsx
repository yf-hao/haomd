import { useEffect, useMemo, useRef, useState, forwardRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { createExtensions, type EditorOptions } from './extensions'
import { useResolvedThemeMode } from '../../modules/theme/ThemeContext'

export type CodeEditorProps = {
  value: string
  documentKey?: string | null
  preserveLocalDocument?: boolean
  onChange?: (value: string) => void
  onDocumentChange?: (view: EditorView) => void
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
  const {
    value,
    documentKey,
    preserveLocalDocument = false,
    onChange,
    onDocumentChange,
    onCursorChange,
    readOnly,
    extensions,
    className,
    placeholder,
    onViewReady,
    onFoldRegionsChange,
    editorZoom,
  } = props
  const themeMode = useResolvedThemeMode()
  const [editorValue, setEditorValue] = useState(value)
  const editorViewRef = useRef<EditorView | null>(null)
  const onViewReadyRef = useRef(onViewReady)
  const onChangeRef = useRef(onChange)
  const onDocumentChangeRef = useRef(onDocumentChange)
  const isComposingRef = useRef(false)
  const lastForwardedValueRef = useRef(value)
  const lastPropValueRef = useRef(value)
  const lastDocumentKeyRef = useRef(documentKey)
  const hasLocalDocumentChangesRef = useRef(false)
  const pendingExternalValueRef = useRef<string | null>(null)
  const applyingExternalValueRef = useRef(false)

  useEffect(() => {
    onViewReadyRef.current = onViewReady
  }, [onViewReady])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onDocumentChangeRef.current = onDocumentChange
  }, [onDocumentChange])

  useEffect(() => {
    return () => {
      editorViewRef.current = null
      onViewReadyRef.current?.(null)
    }
  }, [])

  useEffect(() => {
    const documentChanged = documentKey !== lastDocumentKeyRef.current
    if (documentChanged) {
      lastDocumentKeyRef.current = documentKey
      hasLocalDocumentChangesRef.current = false
    }
    if (!documentChanged && value === lastPropValueRef.current) return
    lastPropValueRef.current = value

    const view = editorViewRef.current
    const currentDocument = view?.state.doc.toString()
    if (
      !documentChanged &&
      preserveLocalDocument &&
      hasLocalDocumentChangesRef.current &&
      currentDocument !== value
    ) {
      return
    }

    if (isComposingRef.current || view?.composing) {
      pendingExternalValueRef.current = value
      return
    }

    pendingExternalValueRef.current = null
    hasLocalDocumentChangesRef.current = false
    lastForwardedValueRef.current = value
    if (view && currentDocument !== value) {
      applyingExternalValueRef.current = true
      try {
        view.dispatch({
          changes: {
            from: 0,
            to: view.state.doc.length,
            insert: value,
          },
        })
      } finally {
        applyingExternalValueRef.current = false
      }
    }
    setEditorValue(value)
  }, [documentKey, preserveLocalDocument, value])

  const forwardChange = (nextValue: string) => {
    if (nextValue === lastForwardedValueRef.current) return
    lastForwardedValueRef.current = nextValue
    onChangeRef.current?.(nextValue)
  }

  const flushComposition = () => {
    queueMicrotask(() => {
      const view = editorViewRef.current
      if (!view || view.dom.isConnected === false) return
      const nextValue = view.state.doc.toString()
      setEditorValue(nextValue)
      forwardChange(nextValue)
      onDocumentChangeRef.current?.(view)

      const pendingExternalValue = pendingExternalValueRef.current
      pendingExternalValueRef.current = null
      if (pendingExternalValue !== null && pendingExternalValue !== nextValue) {
        applyingExternalValueRef.current = true
        try {
          view.dispatch({
            changes: {
              from: 0,
              to: view.state.doc.length,
              insert: pendingExternalValue,
            },
          })
        } finally {
          applyingExternalValueRef.current = false
        }
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
        if (preserveLocalDocument) {
          hasLocalDocumentChangesRef.current = true
        }
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
          if (
            update.docChanged &&
            !update.view.compositionStarted &&
            !update.view.composing &&
            !applyingExternalValueRef.current
          ) {
            hasLocalDocumentChangesRef.current = true
            onDocumentChangeRef.current?.(update.view)
          }
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
