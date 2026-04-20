import type { FC } from 'react'
import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useI18n } from '../modules/i18n/I18nContext'

export type IssueReportDialogProps = {
  open: boolean
  onClose: () => void
}

const SUPPORT_EMAIL = 'hyfdbd@qq.com'
const GITHUB_ISSUES_URL = 'https://github.com/yf-hao/haomd/issues'

export const IssueReportDialog: FC<IssueReportDialogProps> = ({ open, onClose }) => {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)

  if (!open) return null

  const handleCopyEmail = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(SUPPORT_EMAIL)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }
    } catch (err) {
      console.warn('[IssueReportDialog] copy email failed', err)
    }
  }

  const handleOpenGitHub = () => {
    void invoke('open_webview_browser', { url: GITHUB_ISSUES_URL }).catch((err) => {
      console.warn('[IssueReportDialog] open GitHub failed', err)
    })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-issue-report" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{t('issueReport.title')}</div>
        <div className="modal-content issue-report-body">
          <div className="issue-report-intro">{t('issueReport.intro')}</div>

          <div className="issue-report-grid">
            <div className="issue-report-section issue-report-card">
              <div className="field-label issue-report-label">{t('issueReport.email')}</div>
              <div className="issue-report-value">{SUPPORT_EMAIL}</div>
            </div>

            <div className="issue-report-section issue-report-card">
              <div className="field-label issue-report-label">{t('issueReport.githubIssues')}</div>
              <div className="issue-report-value">{GITHUB_ISSUES_URL}</div>
            </div>
          </div>
        </div>
        <div className="modal-actions">
          <button className="ghost issue-report-btn issue-report-btn-secondary" type="button" onClick={handleCopyEmail}>
            {copied ? t('issueReport.copiedEmail') : t('issueReport.copyEmail')}
          </button>
          <button className="ghost primary issue-report-btn issue-report-btn-link" type="button" onClick={handleOpenGitHub}>
            {t('issueReport.openGitHub')}
          </button>
          <button className="ghost primary" type="button" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
