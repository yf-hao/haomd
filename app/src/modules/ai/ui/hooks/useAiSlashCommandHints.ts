import { useEffect, useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { listAiSlashCommands } from '../aiSlashCommands'

export type SlashCommandHintItem = {
  name: string
  description: string
}

export interface UseAiSlashCommandHintsOptions {
  /** 当前输入框完整内容 */
  input: string
  /** 当前光标位置（selectionStart） */
  cursorIndex: number
}

export interface UseAiSlashCommandHintsResult {
  /** 是否显示提示浮层 */
  isOpen: boolean
  /** 当前命令查询前缀（去除前导 /） */
  query: string
  items: SlashCommandHintItem[]
  activeIndex: number
  /** 手动关闭浮层（例如输入框失焦时调用） */
  close: () => void
  /** 处理方向键 / Esc 等导航键，如果已消费返回 true */
  handleKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => boolean
  /** 计算将当前选中项（或指定索引）应用到输入框时的替换范围及文本 */
  getReplacement: (indexOverride?: number) => { start: number; end: number; text: string } | null
}

interface SlashSegmentInfo {
  start: number
  end: number
  query: string
}

export function useAiSlashCommandHints(options: UseAiSlashCommandHintsOptions): UseAiSlashCommandHintsResult {
  const { input, cursorIndex } = options

  const [activeIndex, setActiveIndex] = useState(0)
  const [manuallyClosed, setManuallyClosed] = useState(false)

  const allCommands = useMemo(() => listAiSlashCommands(), [])

  const segment: SlashSegmentInfo | null = useMemo(() => {
    if (!input) return null
    const safeCursor = Math.max(0, Math.min(cursorIndex, input.length))

    // 仅考虑当前行（光标所在行）行首到光标之间的内容
    const lastNewline = input.lastIndexOf('\n', safeCursor - 1)
    const lineStart = lastNewline === -1 ? 0 : lastNewline + 1
    const prefix = input.slice(lineStart, safeCursor)

    // 只识别形如 "/" 或 "/cmd" 的行首命令片段
    const match = /^\/(\S*)$/.exec(prefix)
    if (!match) return null

    const query = match[1].toLowerCase()
    return { start: lineStart, end: safeCursor, query }
  }, [input, cursorIndex])

  // 每次检测到新的命令片段时，重置手动关闭状态
  useEffect(() => {
    if (!segment) {
      setManuallyClosed(false)
    }
  }, [segment])

  const { items, query } = useMemo(() => {
    if (!segment) {
      return { items: [] as SlashCommandHintItem[], query: '' }
    }

    const q = segment.query.trim().toLowerCase()
    let candidates = allCommands

    if (q) {
      const byPrefix = candidates.filter((cmd) => cmd.name.startsWith(q))
      if (byPrefix.length > 0) {
        candidates = byPrefix
      } else {
        const qLower = q.toLowerCase()
        candidates = candidates.filter(
          (cmd) =>
            cmd.name.toLowerCase().includes(qLower) ||
            cmd.description.toLowerCase().includes(qLower),
        )
      }
    }

    const nextItems: SlashCommandHintItem[] = candidates.map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
    }))

    return { items: nextItems, query: q }
  }, [allCommands, segment])

  // 当查询或候选列表发生变化时，将高亮项重置为第一个
  useEffect(() => {
    if (items.length > 0) {
      setActiveIndex(0)
    }
  }, [query, items.length])

  const isOpen = !!segment && items.length > 0 && !manuallyClosed

  const close = () => {
    setManuallyClosed(true)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!isOpen) return false

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (items.length === 0) return true
      setActiveIndex((prev) => (prev + 1) % items.length)
      return true
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (items.length === 0) return true
      setActiveIndex((prev) => (prev - 1 + items.length) % items.length)
      return true
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return true
    }

    return false
  }

  const getReplacement: UseAiSlashCommandHintsResult['getReplacement'] = (indexOverride) => {
    if (!isOpen || !segment || items.length === 0) return null
    const idx = indexOverride != null ? indexOverride : activeIndex
    if (idx < 0 || idx >= items.length) return null

    const item = items[idx]
    return {
      start: segment.start,
      end: segment.end,
      text: `/${item.name} `,
    }
  }

  return {
    isOpen,
    query,
    items,
    activeIndex,
    close,
    handleKeyDown,
    getReplacement,
  }
}
