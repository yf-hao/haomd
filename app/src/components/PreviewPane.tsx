import { MarkdownViewer } from './MarkdownViewer'
import './PreviewPane.css'

export type PreviewPaneProps = {
  value: string
  activeLine: number
  previewWidth: number
  fullWidth?: boolean
}

export function PreviewPane({ value, activeLine, previewWidth, fullWidth }: PreviewPaneProps) {
  return (
    <section
      className="pane preview"
      style={fullWidth ? { gridColumn: '1 / -1' } : undefined}
    >
      <div className="preview-body">
        <MarkdownViewer value={value} activeLine={activeLine} previewWidth={previewWidth} />
      </div>
    </section>
  )
}
