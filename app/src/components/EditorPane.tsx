import { useEffect, useMemo, type CSSProperties, type RefObject } from 'react'
import { EditorView } from '@codemirror/view'
import { SearchQuery, setSearchQuery } from '@codemirror/search'
import { CodeEditor } from './Editor/CodeEditor'
import { setCustomSearchQuery } from './Editor/searchHighlight'
import { useThemeContext } from '../modules/theme/ThemeContext'
import { useI18n } from '../modules/i18n/I18nContext'
import { buildBackgroundImageVars, resolveManagedBackgroundImageUrl } from '../modules/theme/backgroundImageRuntime'
import './EditorPane.css'

export type EditorFocusRequest = {
  localLine: number
  columnStart?: number
}

export type EditorTransientSearchQuery = {
  searchText: string
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
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
  transientSearchQuery?: EditorTransientSearchQuery | null
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
    transientSearchQuery,
  } = props
  const { themeSettings } = useThemeContext()
  const { t } = useI18n()
  const currentEditorBackground = themeSettings.editorBackground

  const editorBackgroundUrl = useMemo(() => {
    const editorBackground = currentEditorBackground
    if (!editorBackground?.enabled || !editorBackground.path) return null

    return resolveManagedBackgroundImageUrl(editorBackground.path)
  }, [currentEditorBackground])

  const editorBackgroundStyle = useMemo(() => {
    if (!editorBackgroundUrl || !currentEditorBackground) return undefined
    return {
      ...buildBackgroundImageVars(currentEditorBackground, { maxOpacity: 0.4 }),
      '--editor-bg-opacity': `var(--background-image-opacity)`,
      '--editor-bg-overlay-opacity': `var(--background-image-overlay-opacity)`,
      '--editor-bg-blur': `var(--background-image-blur)`,
      '--editor-bg-brightness': `var(--background-image-brightness)`,
      '--editor-bg-size': currentEditorBackground.size,
      '--editor-bg-position-x': `var(--background-image-position-x)`,
      '--editor-bg-position-y': `var(--background-image-position-y)`,
    } as CSSProperties
  }, [currentEditorBackground, editorBackgroundUrl])

  // 处理外部聚焦请求：滚动到指定行列
  useEffect(() => {
    if (!focusRequest) return
    const view = editorViewRef.current
    if (!view) return

    const doc = view.state.doc
    const docText = doc.toString()
    // 等待 CodeMirror 用最新 markdown 同步完文档
    if (docText !== markdown) return

    onProgrammaticScrollStart?.()

    const safeLine = focusRequest.localLine > 0 ? Math.min(focusRequest.localLine, doc.lines) : 1
    const targetLine = doc.line(safeLine)
    const safeColumnOffset = Math.max(0, (focusRequest.columnStart ?? 1) - 1)
    const pos = Math.min(targetLine.from + safeColumnOffset, targetLine.to)

    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'center' }),
      scrollIntoView: true,
    })

    onFocusHandled?.()
    onProgrammaticScrollEnd?.()
  }, [focusRequest, editorViewRef, onFocusHandled, onProgrammaticScrollStart, onProgrammaticScrollEnd, markdown])

  useEffect(() => {
    const view = editorViewRef.current
    if (!view) return

    if (!transientSearchQuery?.searchText.trim()) {
      view.dispatch({
        effects: [
          setSearchQuery.of(new SearchQuery({ search: '' })),
          setCustomSearchQuery.of(null),
        ],
      })
      return
    }

    const query = new SearchQuery({
      search: transientSearchQuery.searchText,
      caseSensitive: transientSearchQuery.caseSensitive ?? false,
      wholeWord: transientSearchQuery.wholeWord ?? false,
      regexp: transientSearchQuery.regex ?? false,
    })

    view.dispatch({
      effects: [
        setSearchQuery.of(query),
        setCustomSearchQuery.of(query),
      ],
    })
  }, [editorViewRef, transientSearchQuery])

  return (
    <div
      className={`editor-pane-frame ${currentEditorBackground?.enabled && currentEditorBackground?.path ? 'has-editor-background' : ''} editor-bg-fit-${currentEditorBackground?.size ?? 'cover'}`}
      style={editorBackgroundStyle}
    >
      {editorBackgroundUrl ? (
        <>
          <img
            className="editor-pane-background"
            src={editorBackgroundUrl}
            alt=""
            aria-hidden="true"
          />
          <div className="editor-pane-background-overlay" aria-hidden="true" />
        </>
      ) : null}
      <CodeEditor
        value={markdown}
        onChange={onChange}
        onCursorChange={onCursorChange}
        placeholder={t('editor.placeholder')}
        className="code-editor"
        editorZoom={editorZoom}
        onViewReady={(view) => {
          editorViewRef.current = view
          onEditorReady?.()
        }}
        onFoldRegionsChange={onFoldRegionsChange}
      />
    </div>
  )
}
