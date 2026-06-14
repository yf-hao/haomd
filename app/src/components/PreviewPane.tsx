import { useEffect, useRef, type CSSProperties } from 'react'
import type { LayoutType } from '../hooks/useWorkspaceLayout'
import { MarkdownViewer, type FoldRegion } from './MarkdownViewer'
import './PreviewPane.css'
import { useThemeContext } from '../modules/theme/ThemeContext'
import {
  buildBackgroundImageVars,
  resolveManagedBackgroundImageUrl,
} from '../modules/theme/backgroundImageRuntime'

export type PreviewPaneProps = {
  value: string
  activeLine: number
  previewWidth: number
  effectiveLayout: LayoutType
  loading?: boolean
  loadingLabel?: string
  filePath?: string | null
  foldRegions?: FoldRegion[]
  /** 点击预览中的块时回调对应的源行号 */
  onPreviewLineClick?: (line: number) => void
  /** 预览区域文字选中变更回调 */
  onSelectionChange?: (text: string | null) => void
}

function isHtmlFile(path: string | null | undefined): boolean {
  if (!path) return false
  const lower = path.toLowerCase()
  return lower.endsWith('.html') || lower.endsWith('.htm')
}

type HtmlPreviewProps = {
  html: string
}

function HtmlPreview({ html }: HtmlPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    // 使用 srcdoc 直接渲染当前 HTML 内容
    iframe.srcdoc = html || '<!DOCTYPE html><html><body></body></html>'
  }, [html])

  return <iframe ref={iframeRef} className="html-preview-frame" />
}

export function PreviewPane({
  value,
  activeLine,
  previewWidth,
  effectiveLayout,
  loading = false,
  loadingLabel,
  filePath,
  foldRegions,
  onPreviewLineClick,
  onSelectionChange,
}: PreviewPaneProps) {
  const style: CSSProperties = {}
  const { themeSettings } = useThemeContext()
  const previewRootRef = useRef<HTMLElement | null>(null)

  if (effectiveLayout === 'preview-only') {
    style.gridColumn = '1 / -1'
    style.gridRow = '1 / 2'
  } else if (effectiveLayout === 'preview-left') {
    style.gridColumn = '1 / 2'
    style.gridRow = '1 / 2'
  } else if (effectiveLayout === 'preview-right') {
    style.gridColumn = '2 / 3'
    style.gridRow = '1 / 2'
  }

  const renderHtml = isHtmlFile(filePath)
  const previewBackground = themeSettings.previewBackground
  const previewBackgroundUrl = resolveManagedBackgroundImageUrl(previewBackground?.path)
  const previewBackgroundStyle = buildBackgroundImageVars(previewBackground, { maxOpacity: 0.4 })
  const previewBackgroundFitClass = previewBackground?.enabled
    ? previewBackground.size === 'contain'
      ? 'preview-bg-fit-contain'
      : previewBackground.size === 'height-fill'
        ? 'preview-bg-fit-height-fill'
        : previewBackground.size === 'width-fill'
          ? 'preview-bg-fit-width-fill'
          : previewBackground.size === 'auto'
            ? 'preview-bg-fit-auto'
            : ''
    : ''

  useEffect(() => {
    console.info('[PreviewPane] background config', {
      enabled: previewBackground?.enabled ?? false,
      path: previewBackground?.path ?? null,
      resolvedUrl: previewBackgroundUrl,
      opacity: previewBackground?.opacity,
      overlayOpacity: previewBackground?.overlayOpacity,
      blurPx: previewBackground?.blurPx,
      brightness: previewBackground?.brightness,
      size: previewBackground?.size,
      positionX: previewBackground?.positionX,
      positionY: previewBackground?.positionY,
      willRenderImage: Boolean(previewBackground?.enabled && previewBackgroundUrl),
    })
  }, [
    previewBackground?.enabled,
    previewBackground?.path,
    previewBackground?.opacity,
    previewBackground?.overlayOpacity,
    previewBackground?.blurPx,
    previewBackground?.brightness,
    previewBackground?.size,
    previewBackground?.positionX,
    previewBackground?.positionY,
    previewBackgroundUrl,
  ])

  if (effectiveLayout === 'editor-only') {
    return null
  }

  return (
    <section
      ref={previewRootRef}
      className={`pane preview ${previewBackground?.enabled && previewBackgroundUrl ? 'has-preview-background' : ''} ${previewBackgroundFitClass}`}
      style={{ ...style, ...previewBackgroundStyle }}
    >
      {effectiveLayout !== 'preview-only' && <div className="preview-top-offset" aria-hidden />}
      {previewBackground?.enabled && previewBackgroundUrl ? (
        <>
          <img
            className="preview-background"
            src={previewBackgroundUrl}
            alt=""
            aria-hidden="true"
            onLoad={(event) => {
              const img = event.currentTarget
              const root = previewRootRef.current
              const computed = getComputedStyle(img)
              console.info('[PreviewPane] background image loaded', {
                path: previewBackground?.path,
                resolvedUrl: previewBackgroundUrl,
                currentSrc: img.currentSrc,
                naturalWidth: img.naturalWidth,
                naturalHeight: img.naturalHeight,
                opacity: previewBackground?.opacity,
                overlayOpacity: previewBackground?.overlayOpacity,
                blurPx: previewBackground?.blurPx,
                brightness: previewBackground?.brightness,
                size: previewBackground?.size,
                positionX: previewBackground?.positionX,
                positionY: previewBackground?.positionY,
                imageRect: img.getBoundingClientRect(),
                rootRect: root?.getBoundingClientRect(),
                computedOpacity: computed.opacity,
                computedFilter: computed.filter,
                computedObjectFit: computed.objectFit,
                computedObjectPosition: computed.objectPosition,
                rootBackground: root ? getComputedStyle(root).backgroundColor : null,
              })
            }}
            onError={(event) => {
              const img = event.currentTarget
              console.error('[PreviewPane] background image failed to load', {
                path: previewBackground?.path,
                resolvedUrl: previewBackgroundUrl,
                currentSrc: img.currentSrc,
              })
            }}
          />
          <div className="preview-background-overlay" aria-hidden="true" />
        </>
      ) : null}
      <div className={renderHtml ? 'preview-body preview-body-html' : 'preview-body'}>
        {renderHtml ? (
          <HtmlPreview html={value} />
        ) : (
          <MarkdownViewer
            value={value}
            activeLine={activeLine}
            previewWidth={previewWidth}
            filePath={filePath}
            foldRegions={foldRegions}
            onLineClick={onPreviewLineClick}
            onSelectionChange={onSelectionChange}
          />
        )}
        {loading ? (
          <div className="preview-loading-overlay">
            <span className="preview-loading-text">{loadingLabel ?? 'Loading preview...'}</span>
          </div>
        ) : null}
      </div>
    </section>
  )
}
