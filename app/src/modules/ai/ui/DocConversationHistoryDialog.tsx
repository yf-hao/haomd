import type { FC, MouseEventHandler, MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { DocConversationMessage, DocConversationRecord } from '../domain/docConversations'
import { getDirKeyFromDocPath } from '../domain/docPathUtils'
import { docConversationService } from '../application/docConversationService'

export type DocConversationHistoryDialogProps = {
  open: boolean
  docPath: string
  onClose: () => void
}

type ConversationGroup = {
  id: string
  userMessages: DocConversationMessage[]
  assistantMessages: DocConversationMessage[]
  systemMessages: DocConversationMessage[]
  startedAt: number
}

function buildConversationGroups(messages: DocConversationMessage[]): ConversationGroup[] {
  if (!messages.length) return []

  const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp)
  const groups: ConversationGroup[] = []
  let current: ConversationGroup | null = null

  for (const m of sorted) {
    if (!current) {
      current = {
        id: m.id,
        userMessages: [],
        assistantMessages: [],
        systemMessages: [],
        startedAt: m.timestamp,
      }
      groups.push(current)
    }

    if (m.role === 'system') {
      current.systemMessages.push(m)
      continue
    }

    if (m.role === 'user') {
      // 简单策略：如果当前组已经有 user 或 assistant，则开启新组；否则归入当前组
      if (current.userMessages.length > 0 || current.assistantMessages.length > 0) {
        current = {
          id: m.id,
          userMessages: [m],
          assistantMessages: [],
          systemMessages: [],
          startedAt: m.timestamp,
        }
        groups.push(current)
      } else {
        current.userMessages.push(m)
      }
      continue
    }

    if (m.role === 'assistant') {
      current.assistantMessages.push(m)
      continue
    }
  }

  return groups
}

function buildMarkdownFromDocRecord(record: DocConversationRecord, groups: ConversationGroup[]): string {
  const lines: string[] = []

  lines.push('# AI 会话历史（当前目录会话）')
  lines.push('')
  lines.push(`- 导出时间：${new Date().toLocaleString()}`)
  lines.push(`- 总消息数：${record.messages.length}`)
  lines.push(`- 总对话轮次：${groups.length}`)
  lines.push('')
  lines.push('---')
  lines.push('')

  groups.forEach((g, index) => {
    lines.push(`## 对话 ${index + 1}`)
    lines.push('')

    if (g.systemMessages.length) {
      g.systemMessages.forEach((m) => {
        lines.push('**System**')
        lines.push('')
        lines.push(`> ${m.content}`)
        lines.push('')
      })
    }

    if (g.userMessages.length) {
      const first = g.userMessages[0]
      lines.push(`- 时间：${new Date(first.timestamp).toLocaleString()}`)
      lines.push('')
      lines.push('**User**')
      lines.push('')
      g.userMessages.forEach((m) => {
        lines.push(`> ${m.content}`)
        lines.push('')
      })
    }

    if (g.assistantMessages.length) {
      const first = g.assistantMessages[0]
      const meta = first.meta || {}
      const provider = meta.providerType ?? 'unknown'
      const model = meta.modelName ?? ''
      const label = model ? `${provider} / ${model}` : provider
      lines.push(`**Assistant: （${label}）**`)
      lines.push('')
      g.assistantMessages.forEach((m) => {
        lines.push(`> ${m.content}`)
        lines.push('')
      })
    }

    lines.push('---')
    lines.push('')
  })

  return lines.join('\n')
}

export const DocConversationHistoryDialog: FC<DocConversationHistoryDialogProps> = ({ open, docPath, onClose }) => {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [record, setRecord] = useState<DocConversationRecord | null>(null)
  const [groups, setGroups] = useState<ConversationGroup[]>([])
  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(10)

  const dirKey = useMemo(() => getDirKeyFromDocPath(docPath) ?? docPath, [docPath])

  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStateRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)

  useEffect(() => {
    if (!open) return

    let cancelled = false
    setLoading(true)
    setError(null)

    ;(async () => {
      try {
        const rec = await docConversationService.getByDocPath(dirKey)
        if (cancelled) return
        setRecord(rec)

        if (!rec || !rec.messages.length) {
          setGroups([])
          setPageIndex(0)
          return
        }

        const built = buildConversationGroups(rec.messages)
        setGroups(built)

        // 默认跳到最后一页（最新对话）
        const totalPages = Math.max(1, Math.ceil(built.length / pageSize))
        setPageIndex(totalPages - 1)
      } catch (e) {
        if (cancelled) return
        setError(e as Error)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, dirKey, pageSize])

  const hasData = !!record && record.messages.length > 0 && groups.length > 0

  const { pageGroups, totalPages, displayPageIndex } = useMemo(() => {
    if (!groups.length) {
      return {
        pageGroups: [] as ConversationGroup[],
        totalPages: 1,
        displayPageIndex: 0,
      }
    }

    const total = Math.max(1, Math.ceil(groups.length / pageSize))
    const safeIndex = Math.min(Math.max(pageIndex, 0), total - 1)
    const start = safeIndex * pageSize
    const end = start + pageSize

    return {
      pageGroups: groups.slice(start, end),
      totalPages: total,
      displayPageIndex: safeIndex,
    }
  }, [groups, pageIndex, pageSize])

  const handlePrevPage = useCallback(() => {
    setPageIndex((prev) => Math.max(0, prev - 1))
  }, [])

  const handleNextPage = useCallback(() => {
    setPageIndex((prev) => {
      const total = Math.max(1, Math.ceil(groups.length / pageSize))
      return Math.min(total - 1, prev + 1)
    })
  }, [groups.length, pageSize])

  const handlePageSizeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = Number(e.target.value)
    if (!Number.isNaN(next) && next > 0) {
      setPageSize(next)
      // 重置到最后一页，方便查看最新对话
      const total = Math.max(1, Math.ceil(groups.length / next))
      setPageIndex(total - 1)
    }
  }, [groups.length])

  const handleDragStart: MouseEventHandler<HTMLDivElement> = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement | null
    if (target) {
      const interactive = target.closest('select, button, input, textarea')
      if (interactive) return
    }
    const { clientX, clientY } = e
    dragStateRef.current = {
      startX: clientX,
      startY: clientY,
      originX: dragOffset.x,
      originY: dragOffset.y,
    }
    setDragging(true)
    e.preventDefault()
  }

  useEffect(() => {
    if (!dragging) return
    const handleMove = (e: MouseEvent) => {
      const state = dragStateRef.current
      if (!state) return
      const dx = e.clientX - state.startX
      const dy = e.clientY - state.startY
      setDragOffset({ x: state.originX + dx, y: state.originY + dy })
    }
    const handleUp = () => {
      setDragging(false)
      dragStateRef.current = null
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [dragging])

  if (!open) return null

  const handleExportMarkdown = useCallback(async () => {
    if (!record) return
    try {
      const content = buildMarkdownFromDocRecord(record, groups)
      const now = new Date()
      const yyyy = now.getFullYear()
      const mm = String(now.getMonth() + 1).padStart(2, '0')
      const dd = String(now.getDate()).padStart(2, '0')
      const hh = String(now.getHours()).padStart(2, '0')
      const mi = String(now.getMinutes()).padStart(2, '0')
      const ts = `${yyyy}${mm}${dd}-${hh}${mi}`
      const baseName = docPath.split(/[/\\]/).pop()?.replace(/\.[^./\\]+$/, '') || 'document'
      const defaultFileName = `AI History - ${baseName} - ${ts}.md`

      await invoke('save_text_with_dialog', {
        defaultFileName,
        content,
      })
    } catch (e) {
      // 仅在控制台记录错误，不阻塞 UI
      console.error('[DocConversationHistoryDialog] export markdown failed', e)
    }
  }, [record, groups, docPath])

  const summaryLine = (() => {
    if (!record || !record.messages.length) return '当前目录暂无 AI 会话历史'
    const lastTs = new Date(record.lastActiveAt).toLocaleString()
    return `最近活跃时间：${lastTs} · 总消息数：${record.messages.length} · 总对话轮次：${groups.length}`
  })()

  return (
    <div className="modal-backdrop modal-backdrop-plain" onClick={onClose}>
      <div
        className="modal modal-ai-chat modal-ai-history"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-title ai-chat-title">
          <button
            type="button"
            className="ai-chat-close-button"
            aria-label="关闭会话历史"
            onClick={onClose}
          >
            <span className="ai-chat-close-icon" aria-hidden="true" />
          </button>
          <div className="modal-title-text">AI Session History</div>
          <div className="ai-history-actions">
            <button
              type="button"
              className="ai-history-export-button"
              onClick={handleExportMarkdown}
            >
              导出 Markdown
            </button>
          </div>
        </div>

        <div className="ai-history-summary">
          {loading && <div className="ai-history-status">正在加载文档会话历史…</div>}
          {!loading && error && (
            <div className="ai-history-status ai-history-status-error">加载失败：{error.message}</div>
          )}
          {!loading && !error && (
            <div className="ai-history-status">{summaryLine}</div>
          )}
        </div>

        <div className="ai-history-body">
          {!loading && !error && !hasData && (
            <div className="ai-history-empty">
              当前目录暂无 AI 会话历史。
              <br />
              你可以通过 AI Chat 或 Ask File / Ask Selection 发起对话，历史会自动记录在这里。
            </div>
          )}

          {!loading && !error && hasData && (
            <div className="ai-history-list">
              {pageGroups.map((group, idx) => {
                const groupIndex = displayPageIndex * pageSize + idx + 1
                return (
                  <div className="ai-history-group" key={group.id}>
                    <div className="ai-history-group-header">
                      <span className="ai-history-group-title">对话 {groupIndex}</span>
                    </div>

                    {group.systemMessages.map((m) => (
                      <div key={m.id} className="ai-history-message ai-history-message-system">
                        <div className="ai-history-message-meta">
                          {(() => {
                            const level = m.meta?.summaryLevel ?? 0
                            return level >= 1 ? `摘要 (Level ${level})` : 'System'
                          })()}
                        </div>
                        <div className="ai-history-message-content">{m.content}</div>
                      </div>
                    ))}

                    {group.userMessages.length > 0 && (
                      <div className="ai-history-message ai-history-message-user">
                        <div className="ai-history-message-meta">
                          <span className="ai-history-role">User</span>
                          <span className="ai-history-time">
                            {new Date(group.userMessages[0].timestamp).toLocaleString()}
                          </span>
                        </div>
                        <div className="ai-history-message-content">
                          {group.userMessages.map((m) => (
                            <p key={m.id}>{m.content}</p>
                          ))}
                        </div>
                      </div>
                    )}

                    {group.assistantMessages.length > 0 && (
                      <div className="ai-history-message ai-history-message-assistant">
                        <div className="ai-history-message-meta">
                          <span className="ai-history-role">Assistant</span>
                          <span className="ai-history-model">
                            {(() => {
                              const meta = group.assistantMessages[0].meta
                              const provider = meta?.providerType ?? 'unknown'
                              const model = meta?.modelName ?? ''
                              return model ? `${provider} / ${model}` : provider
                            })()}
                          </span>
                        </div>
                        <div className="ai-history-message-content">
                          {group.assistantMessages.map((m) => (
                            <p key={m.id}>{m.content}</p>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="ai-history-group-divider" />
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="ai-history-footer">
          <div className="ai-history-pagination">
            <button
              type="button"
              className="ai-history-page-button"
              onClick={handlePrevPage}
              disabled={displayPageIndex <= 0}
            >
              上一页
            </button>
            <span className="ai-history-page-info">
              第 {displayPageIndex + 1} / {totalPages} 页
            </span>
            <button
              type="button"
              className="ai-history-page-button"
              onClick={handleNextPage}
              disabled={displayPageIndex >= totalPages - 1}
            >
              下一页
            </button>
          </div>

          <div className="ai-history-page-size">
            每页
            <select value={pageSize} onChange={handlePageSizeChange}>
              <option value={5}>5 组</option>
              <option value={10}>10 组</option>
              <option value={20}>20 组</option>
            </select>
            对话
          </div>
        </div>

        <div className="ai-chat-drag-handle ai-chat-drag-bottom" onMouseDown={handleDragStart} />
        <div className="ai-chat-drag-handle ai-chat-drag-left" onMouseDown={handleDragStart} />
        <div className="ai-chat-drag-handle ai-chat-drag-right" onMouseDown={handleDragStart} />
      </div>
    </div>
  )
}
