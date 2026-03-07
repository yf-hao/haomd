import type { FC, MouseEvent } from 'react'
import { useEffect, useState } from 'react'
import { getHistoryPage } from '../application/historyViewService'

export interface AiChatHistoryDialogProps {
  open: boolean
  directoryKey: string
  pageSize?: number
  onClose: () => void
}

/**
 * AI Chat 输入历史弹窗：
 * - 按时间顺序编号（最早为 1，最新编号最大）；
 * - 每页显示最近的 N 条（默认 10 条），pageIndex=0 为“最新页”；
 * - 提供 Previous / Next 按钮在页间切换；
 * - 每行展示格式为：编号 + 四个空格 + 内容。
 */
export const AiChatHistoryDialog: FC<AiChatHistoryDialogProps> = ({
  open,
  directoryKey,
  pageSize = 10,
  onClose,
}) => {
  const [pageIndex, setPageIndex] = useState(0)

  // 当目录或 open 变化时，重新回到最新页
  useEffect(() => {
    if (!open) return
    setPageIndex(0)
  }, [open, directoryKey])

  if (!open) return null

  const page = getHistoryPage(directoryKey, pageIndex, pageSize)
  const hasPrev = page.pageIndex < page.totalPages - 1
  const hasNext = page.pageIndex > 0

  const handleBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    onClose()
  }

  const handleDialogClick = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
  }

  return (
    <div className="modal-backdrop modal-backdrop-plain" onClick={handleBackdropClick}>
      <div className="modal modal-ai-chat ai-chat-history-dialog" onClick={handleDialogClick}>
        <div className="modal-title ai-chat-title">
          <div className="modal-title-text">Input History</div>
          <button
            type="button"
            className="ai-chat-close-button"
            aria-label="Close Input History"
            onClick={onClose}
          >
            <span className="ai-chat-close-icon" aria-hidden="true" />
          </button>
        </div>

        <div className="ai-chat-history-body">
          {page.items.length === 0 ? (
            <div className="ai-chat-history-empty">No history yet.</div>
          ) : (
            <ul className="ai-chat-history-list">
              {page.items.map((item) => (
                <li key={item.ordinal} className="ai-chat-history-item">
                  <span className="ai-chat-history-ordinal">{item.ordinal}</span>
                  <span className="ai-chat-history-text">{item.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="ai-chat-history-footer">
          <button
            type="button"
            className="ai-chat-history-prev"
            disabled={!hasPrev}
            onClick={() => {
              if (!hasPrev) return
              setPageIndex((prev) => prev + 1)
            }}
          >
            Previous
          </button>
          <span className="ai-chat-history-page-indicator">
            {page.totalPages > 0
              ? `Page ${page.pageIndex + 1} of ${page.totalPages}`
              : 'Page 0 of 0'}
          </span>
          <button
            type="button"
            className="ai-chat-history-next"
            disabled={!hasNext}
            onClick={() => {
              if (!hasNext) return
              setPageIndex((prev) => Math.max(0, prev - 1))
            }}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
