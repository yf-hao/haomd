import { useEffect, useMemo, useRef, useCallback, forwardRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import type { Extension } from '@codemirror/state'
import type { EditorView, ViewUpdate } from '@codemirror/view'
import { createExtensions, type EditorOptions } from './extensions'
import { useResolvedThemeMode } from '../../modules/theme/ThemeContext'

export type CodeEditorProps = {
  value: string
  documentKey?: string | null
  preserveLocalDocument?: boolean
  onChange?: (value: string) => void
  onDocumentChange?: (change: ViewUpdate | EditorView) => void
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
  // The wrapper initializes the native document once. External replacements are
  // applied below, so an unrelated React render cannot replay a stale value.
  const initialValueRef = useRef(value)
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
  const pendingDocumentSwitchRef = useRef(false)
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
      pendingDocumentSwitchRef.current ||= documentChanged
      return
    }

    pendingExternalValueRef.current = null
    pendingDocumentSwitchRef.current = false
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
  }, [documentKey, preserveLocalDocument, value])

  const forwardChange = useCallback((nextValue: string) => {
    if (nextValue === lastForwardedValueRef.current) return
    lastForwardedValueRef.current = nextValue
    onChangeRef.current?.(nextValue)
  }, [])

  const flushComposition = useCallback(() => {
    const expectedView = editorViewRef.current
    const expectedKey = lastDocumentKeyRef.current
    queueMicrotask(() => {
      const view = editorViewRef.current
      if (!view || view !== expectedView || expectedKey !== lastDocumentKeyRef.current || !view.dom.isConnected) return
      // A composition from the outgoing document must not be reported to the new tab.
      if (!pendingDocumentSwitchRef.current) {
        if (onChangeRef.current) forwardChange(view.state.doc.toString())
        onDocumentChangeRef.current?.(view)
      }

      const pendingExternalValue = pendingExternalValueRef.current
      pendingExternalValueRef.current = null
      if (pendingDocumentSwitchRef.current) hasLocalDocumentChangesRef.current = false
      pendingDocumentSwitchRef.current = false
      if (pendingExternalValue !== null && pendingExternalValue !== view.state.doc.toString()) {
        applyingExternalValueRef.current = true
        try {
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: pendingExternalValue } })
        } finally {
          applyingExternalValueRef.current = false
        }
        lastForwardedValueRef.current = pendingExternalValue
      }
    })
  }, [forwardChange])

  const handleChange = useCallback((val: string) => {
    if (!applyingExternalValueRef.current && !isComposingRef.current && !editorViewRef.current?.composing) {
      forwardChange(val)
    }
  }, [forwardChange])

  const handleUpdate = useCallback((update: ViewUpdate) => {
    if (!update.docChanged || applyingExternalValueRef.current) return
    hasLocalDocumentChangesRef.current = true
    if (!isComposingRef.current && !update.view.compositionStarted && !update.view.composing) {
      onDocumentChangeRef.current?.(update)
    }
  }, [])

  const handleCreateEditor = useCallback((view: EditorView) => {
    editorViewRef.current = view
    onViewReadyRef.current?.(view)
  }, [])

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
        value={initialValueRef.current}
        onChange={onChange ? handleChange : undefined}
        onUpdate={handleUpdate}
        onCreateEditor={handleCreateEditor}
      />
    </div>
  )
})

export default CodeEditor
