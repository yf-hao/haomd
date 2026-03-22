import type { RecentFile } from '../modules/files/types'
import type { EditorTab } from '../types/tabs'
import { useI18n } from '../modules/i18n/I18nContext'

export type PdfSidebarPanelProps = {
    sidebarWidth: number
    pdfRecentLoading: boolean
    pdfRecentError: string | null
    pdfRecent: RecentFile[]
    activeTab: EditorTab | null
    openRecentFileInNewTab: (path: string) => Promise<any>
}

export function PdfSidebarPanel(props: PdfSidebarPanelProps) {
    const { t } = useI18n()
    const {
        sidebarWidth,
        pdfRecentLoading,
        pdfRecentError,
        pdfRecent,
        activeTab,
        openRecentFileInNewTab,
    } = props

    return (
        <div className="pdf-panel" style={{ width: sidebarWidth }}>
            <div className="pdf-panel-header">
                <span>{t('pdf.title')}</span>
            </div>
            <div className="pdf-panel-content">
                {pdfRecentLoading && (
                    <p style={{ color: 'var(--theme-text-muted)', padding: '12px', fontSize: '13px' }}>{t('pdf.loadingRecent')}</p>
                )}
                {!pdfRecentLoading && pdfRecentError && (
                    <p style={{ color: 'var(--theme-accent-danger)', padding: '12px', fontSize: '13px' }}>{pdfRecentError}</p>
                )}
                {!pdfRecentLoading && !pdfRecentError && pdfRecent.length === 0 && (
                    <p style={{ color: 'var(--theme-text-muted)', padding: '12px', fontSize: '13px' }}>
                        {t('pdf.noRecent')}
                    </p>
                )}
                {!pdfRecentLoading && !pdfRecentError && pdfRecent.length > 0 && (
                    <ul className="pdf-recent-list">
                        {pdfRecent.map((item) => {
                            const name = item.displayName || item.path.split(/[/\\]/).pop() || item.path
                            const isActive = activeTab?.path === item.path
                            return (
                                <li
                                    key={item.path}
                                    className={`pdf-recent-item ${isActive ? 'active' : ''}`}
                                    onClick={() => { void openRecentFileInNewTab(item.path) }}
                                >
                                    <div className="pdf-recent-title">{name}</div>
                                </li>
                            )
                        })}
                    </ul>
                )}
            </div>
        </div>
    )
}
