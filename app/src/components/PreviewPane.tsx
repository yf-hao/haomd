import { useEffect, useRef, type CSSProperties } from 'react'
import type { LayoutType } from '../hooks/useWorkspaceLayout'
import { MarkdownViewer, type FoldRegion } from './MarkdownViewer'
import './PreviewPane.css'

export type PreviewPaneProps = {
  value: string
  activeLine: number
  previewWidth: number
  effectiveLayout: LayoutType
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

export function PreviewPane({ value, activeLine, previewWidth, effectiveLayout, filePath, foldRegions, onPreviewLineClick, onSelectionChange }: PreviewPaneProps) {
  const style: CSSProperties = {}

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

  if (effectiveLayout === 'editor-only') {
    return null
  }

  const renderHtml = isHtmlFile(filePath)

  return (
    <section className="pane preview" style={style}>
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
      </div>
    </section>
  )
}
