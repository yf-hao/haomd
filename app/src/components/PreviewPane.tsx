import type { CSSProperties } from 'react'
import type { LayoutType } from '../hooks/useWorkspaceLayout'
import { MarkdownViewer } from './MarkdownViewer'
import './PreviewPane.css'

export type PreviewPaneProps = {
  value: string
  activeLine: number
  previewWidth: number
  effectiveLayout: LayoutType
  filePath?: string | null
}

export function PreviewPane({ value, activeLine, previewWidth, effectiveLayout, filePath }: PreviewPaneProps) {
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
    style.display = 'none'
  }

  return (
    <section className="pane preview" style={style}>
      <div className="preview-body">
        <MarkdownViewer value={value} activeLine={activeLine} previewWidth={previewWidth} filePath={filePath} />
      </div>
    </section>
  )
}
