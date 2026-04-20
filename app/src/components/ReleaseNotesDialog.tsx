import type { FC } from 'react'
import changelogDocs from '../../../CHANGELOG.md?raw'
import ReactMarkdown from 'react-markdown'

export type ReleaseNotesDialogProps = {
  open: boolean
  onClose: () => void
}

export const ReleaseNotesDialog: FC<ReleaseNotesDialogProps> = ({ open, onClose }) => {
  if (!open) return null

  const displayDocs = changelogDocs.replace(
    /^All notable changes to this project will be documented in this file\.\n*/m,
    '',
  )

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-release-notes" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">版本说明</div>
        <div className="modal-content release-notes-body">
          <div className="release-notes-markdown markdown-rendered">
            <ReactMarkdown>{displayDocs}</ReactMarkdown>
          </div>
        </div>
        <div className="modal-actions">
          <button className="ghost primary" type="button" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
