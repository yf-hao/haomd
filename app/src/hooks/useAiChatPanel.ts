import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatEntryMode, EntryContext } from '../modules/ai/domain/chatSession'

// AI Chat localStorage keys
const STORAGE_AI_MODE = 'haomd:aiChat:mode'
const STORAGE_AI_DOCK_SIDE = 'haomd:aiChat:dockSide'
const STORAGE_AI_WIDTH_LEFT = 'haomd:aiChat:widthLeft'
const STORAGE_AI_WIDTH_RIGHT = 'haomd:aiChat:widthRight'

export interface AiChatState {
  open: boolean
  entryMode: ChatEntryMode
  initialContext?: EntryContext
  tabId: string
}

export interface UseAiChatPanelParams {
  activeTabId: string | undefined
}

export interface UseAiChatPanelReturn {
  aiChatState: AiChatState | null
  aiChatMode: 'floating' | 'docked'
  setAiChatMode: React.Dispatch<React.SetStateAction<'floating' | 'docked'>>
  aiChatOpen: boolean
  aiChatDockSide: 'left' | 'right'
  setAiChatDockSide: React.Dispatch<React.SetStateAction<'left' | 'right'>>
  aiChatWidthLeft: number
  aiChatWidthRight: number
  isAiChatResizing: boolean
  docHistoryState: { open: boolean; docPath: string | null }
  globalMemoryState: { open: boolean; initialTab: 'persona' | 'manage' }
  openAiChatDialog: (options: { entryMode: ChatEntryMode; initialContext?: EntryContext }) => void
  closeAiChatDialog: () => void
  openDocHistoryDialog: (docPath: string) => void
  closeDocHistoryDialog: () => void
  openGlobalMemoryDialog: (options: { initialTab: 'persona' | 'manage' }) => void
  closeGlobalMemoryDialog: () => void
  handleAiChatResizeStart: (event: any) => void
  outerGridTemplateColumns: string
  aiChatWidth: number
}

export function useAiChatPanel({
  activeTabId,
}: UseAiChatPanelParams): UseAiChatPanelReturn {
  const [aiChatState, setAiChatState] = useState<AiChatState | null>(null)
  const [aiChatMode, setAiChatMode] = useState<'floating' | 'docked'>('docked')
  const [aiChatOpen, setAiChatOpen] = useState(false)
  const [aiChatDockSide, setAiChatDockSide] = useState<'left' | 'right'>('right')
  const [aiChatWidthLeft, setAiChatWidthLeft] = useState(400)
  const [aiChatWidthRight, setAiChatWidthRight] = useState(400)
  const [isAiChatResizing, setIsAiChatResizing] = useState(false)

  const [docHistoryState, setDocHistoryState] = useState<{
    open: boolean
    docPath: string | null
  }>({ open: false, docPath: null })

  const [globalMemoryState, setGlobalMemoryState] = useState<{
    open: boolean
    initialTab: 'persona' | 'manage'
  }>({ open: false, initialTab: 'persona' })

  const aiChatResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const aiChatFirstSaveRef = useRef(true)
  const aiChatPrevDockSideRef = useRef<'left' | 'right'>(aiChatDockSide)

  const aiChatWidth = aiChatDockSide === 'left' ? aiChatWidthLeft : aiChatWidthRight

  const outerGridTemplateColumns = useMemo(() => {
    const aiChatCol = `${aiChatWidth}px`
    // 只有在 docked + 打开 + 有有效会话状态时，才为 AI Chat 预留布局空间
    if (aiChatMode === 'docked' && aiChatOpen && aiChatState) {
      if (aiChatDockSide === 'left') {
        return `${aiChatCol} 1fr`
      }
      return `1fr ${aiChatCol}`
    }
    return '1fr'
  }, [aiChatMode, aiChatOpen, aiChatDockSide, aiChatWidth, aiChatState])

  const handleAiChatResizeStart = useCallback((event: any) => {
    const currentWidth = aiChatDockSide === 'left' ? aiChatWidthLeft : aiChatWidthRight
    aiChatResizeStateRef.current = { startX: event.clientX, startWidth: currentWidth }
    setIsAiChatResizing(true)
    event.preventDefault()
    event.stopPropagation()
  }, [aiChatDockSide, aiChatWidthLeft, aiChatWidthRight])

  // AI Chat Persistence：使用 localStorage 记住模式 / 位置 / 左右宽度（不再记忆是否打开）
  useEffect(() => {
    try {
      if (typeof localStorage === 'undefined') return

      const storedMode = localStorage.getItem(STORAGE_AI_MODE)
      const storedDockSide = localStorage.getItem(STORAGE_AI_DOCK_SIDE)
      const storedLeft = localStorage.getItem(STORAGE_AI_WIDTH_LEFT)
      const storedRight = localStorage.getItem(STORAGE_AI_WIDTH_RIGHT)

      if (storedMode === 'floating' || storedMode === 'docked') {
        setAiChatMode(storedMode)
      }
      if (storedDockSide === 'left' || storedDockSide === 'right') {
        setAiChatDockSide(storedDockSide)
      }
      if (storedLeft != null) {
        const w = Number(storedLeft)
        if (!Number.isNaN(w)) setAiChatWidthLeft(w)
      }
      if (storedRight != null) {
        const w = Number(storedRight)
        if (!Number.isNaN(w)) setAiChatWidthRight(w)
      }
    } catch (e) {
      console.error('Failed to load AI Chat state from localStorage', e)
    }
  }, [])

  const saveAiStore = useCallback(async () => {
    try {
      if (typeof localStorage === 'undefined') return

      localStorage.setItem(STORAGE_AI_MODE, aiChatMode)
      localStorage.setItem(STORAGE_AI_DOCK_SIDE, aiChatDockSide)
      localStorage.setItem(STORAGE_AI_WIDTH_LEFT, String(aiChatWidthLeft))
      localStorage.setItem(STORAGE_AI_WIDTH_RIGHT, String(aiChatWidthRight))
    } catch (e) {
      console.error('Failed to save AI Chat state to localStorage', e)
    }
  }, [aiChatMode, aiChatDockSide, aiChatWidthLeft, aiChatWidthRight])

  useEffect(() => {
    // 首次渲染只作为初始化，不写回 localStorage，避免用默认 400 覆盖已有值
    if (aiChatFirstSaveRef.current) {
      aiChatFirstSaveRef.current = false
      return
    }
    void saveAiStore()
  }, [saveAiStore])

  // 切换 dock 侧边时，沿用当前侧的宽度到新侧，避免左右宽度不一致的跳变
  useEffect(() => {
    const prevSide = aiChatPrevDockSideRef.current
    if (prevSide === aiChatDockSide) return

    if (aiChatDockSide === 'left') {
      // 从右切到左：沿用当前右侧宽度
      setAiChatWidthLeft(aiChatWidthRight)
    } else {
      // 从左切到右：沿用当前左侧宽度
      setAiChatWidthRight(aiChatWidthLeft)
    }

    aiChatPrevDockSideRef.current = aiChatDockSide
  }, [aiChatDockSide, aiChatWidthLeft, aiChatWidthRight])

  // Resize drag effect
  useEffect(() => {
    if (!isAiChatResizing) return

    const handleMove = (e: MouseEvent) => {
      const state = aiChatResizeStateRef.current
      if (!state) return

      let delta = e.clientX - state.startX
      if (aiChatDockSide === 'right') {
        delta = -delta
      }

      let next = state.startWidth + delta
      const MIN_AI_WIDTH = 340
      const MAX_AI_WIDTH = 800

      if (next < MIN_AI_WIDTH) next = MIN_AI_WIDTH
      if (next > MAX_AI_WIDTH) next = MAX_AI_WIDTH

      if (aiChatDockSide === 'left') {
        setAiChatWidthLeft(next)
      } else {
        setAiChatWidthRight(next)
      }
    }

    const handleUp = () => {
      setIsAiChatResizing(false)
      aiChatResizeStateRef.current = null
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)

    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [isAiChatResizing, aiChatDockSide])

  const openAiChatDialog = useCallback(
    (options: { entryMode: ChatEntryMode; initialContext?: EntryContext }) => {
      // 保持当前模式（floating/docked），只负责打开和设置会话参数
      const tabId = activeTabId ?? 'global'
      setAiChatOpen(true)
      setAiChatState({ open: true, tabId, ...options })
    },
    [activeTabId],
  )

  const closeAiChatDialog = useCallback(() => {
    setAiChatOpen(false)
    setAiChatState(null)
  }, [])

  const openDocHistoryDialog = useCallback((docPath: string) => {
    setDocHistoryState({ open: true, docPath })
  }, [])

  const closeDocHistoryDialog = useCallback(() => {
    setDocHistoryState((prev) => ({ ...prev, open: false }))
  }, [])

  const openGlobalMemoryDialog = useCallback((options: { initialTab: 'persona' | 'manage' }) => {
    setGlobalMemoryState({ open: true, initialTab: options.initialTab })
  }, [])

  const closeGlobalMemoryDialog = useCallback(() => {
    setGlobalMemoryState((prev) => ({ ...prev, open: false }))
  }, [])

  return {
    aiChatState,
    aiChatMode,
    setAiChatMode,
    aiChatOpen,
    aiChatDockSide,
    setAiChatDockSide,
    aiChatWidthLeft,
    aiChatWidthRight,
    isAiChatResizing,
    docHistoryState,
    globalMemoryState,
    openAiChatDialog,
    closeAiChatDialog,
    openDocHistoryDialog,
    closeDocHistoryDialog,
    openGlobalMemoryDialog,
    closeGlobalMemoryDialog,
    handleAiChatResizeStart,
    outerGridTemplateColumns,
    aiChatWidth,
  }
}
