import { useEffect, useMemo, type CSSProperties, type RefObject } from 'react'
import { EditorView } from '@codemirror/view'
import { CodeEditor } from './Editor/CodeEditor'
import { useThemeContext } from '../modules/theme/ThemeContext'
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

const editorBackgroundUrlCache = new Map<string, string>()

function encodeEditorBackgroundPath(absPath: string): string {
  const isWindows = absPath.includes('\\') || navigator.userAgent.includes('Windows')
  const cacheKey = `${isWindows ? 'win' : 'unix'}|${absPath}`
  const cached = editorBackgroundUrlCache.get(cacheKey)
  if (cached) return cached

  const pathParts = absPath.split(/([/\\])/)
  const encodedParts = pathParts.map((part) => {
    if (part === '/' || part === '\\') return part
    return encodeURIComponent(part)
  })
  const encoded = encodedParts.join('')
  const finalUrl = isWindows ? `https://haomd.localhost${encoded}` : `haomd://localhost${encoded}`
  editorBackgroundUrlCache.set(cacheKey, finalUrl)
  return finalUrl
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
  const { themeSettings } = useThemeContext()
  const currentEditorBackground = themeSettings.editorBackground

  const editorBackgroundUrl = useMemo(() => {
    const editorBackground = currentEditorBackground
    if (!editorBackground?.enabled || !editorBackground.path) return null

    const normalizedPath = editorBackground.path.trim()
    if (!normalizedPath) return null

    return /^(data:|blob:|https?:)/i.test(normalizedPath)
      ? normalizedPath
      : encodeEditorBackgroundPath(normalizedPath)
  }, [currentEditorBackground])

  const editorBackgroundStyle = useMemo(() => {
    if (!editorBackgroundUrl || !currentEditorBackground) return undefined
    return {
      '--editor-bg-opacity': `${Math.min(Math.max(currentEditorBackground.opacity, 0), 0.4)}`,
      '--editor-bg-overlay-opacity': `${Math.min(Math.max(currentEditorBackground.overlayOpacity ?? 0, 0), 1)}`,
      '--editor-bg-blur': `${Math.min(Math.max(currentEditorBackground.blurPx, 0), 24)}px`,
      '--editor-bg-brightness': `${Math.min(Math.max(currentEditorBackground.brightness, 0), 200)}%`,
      '--editor-bg-size': currentEditorBackground.size,
      '--editor-bg-position-x': `${Math.min(Math.max(currentEditorBackground.positionX, 0), 100)}%`,
      '--editor-bg-position-y': `${Math.min(Math.max(currentEditorBackground.positionY, 0), 100)}%`,
    } as CSSProperties
  }, [currentEditorBackground, editorBackgroundUrl])

  // 处理外部聚焦请求：滚动到指定行或包含特定文本
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
        placeholder="在此输入 Markdown..."
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
