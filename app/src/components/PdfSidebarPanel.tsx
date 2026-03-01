import type { RecentFile } from '../modules/files/types'
import type { EditorTab } from '../types/tabs'

export type PdfSidebarPanelProps = {
    sidebarWidth: number
    pdfRecentLoading: boolean
    pdfRecentError: string | null
    pdfRecent: RecentFile[]
    activeTab: EditorTab | null
    openRecentFileInNewTab: (path: string) => Promise<any>
}

export function PdfSidebarPanel(props: PdfSidebarPanelProps) {
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
                <span>PDF</span>
            </div>
            <div className="pdf-panel-content">
                {pdfRecentLoading && (
                    <p style={{ color: '#9ca3af', padding: '12px', fontSize: '13px' }}>正在加载最近的 PDF...</p>
                )}
                {!pdfRecentLoading && pdfRecentError && (
                    <p style={{ color: '#f97373', padding: '12px', fontSize: '13px' }}>{pdfRecentError}</p>
                )}
                {!pdfRecentLoading && !pdfRecentError && pdfRecent.length === 0 && (
                    <p style={{ color: '#9ca3af', padding: '12px', fontSize: '13px' }}>
                        No recent PDFs. Use File → Open to open a PDF file.
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
