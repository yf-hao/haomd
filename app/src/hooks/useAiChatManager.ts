import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatEntryMode, EntryContext } from '../modules/ai/domain/chatSession'

// AI Chat localStorage keys
const STORAGE_AI_MODE = 'haomd:aiChat:mode'
const STORAGE_AI_DOCK_SIDE = 'haomd:aiChat:dockSide'
const STORAGE_AI_OPEN = 'haomd:aiChat:isOpen'
const STORAGE_AI_WIDTH_LEFT = 'haomd:aiChat:widthLeft'
const STORAGE_AI_WIDTH_RIGHT = 'haomd:aiChat:widthRight'

export type AiChatManagerOptions = {
    activeTabId: string | null
}

export function useAiChatManager({ activeTabId }: AiChatManagerOptions) {
    const [aiChatState, setAiChatState] = useState<{
        open: boolean
        entryMode: ChatEntryMode
        initialContext?: EntryContext
        tabId: string
    } | null>(null)

    const [aiChatMode, setAiChatMode] = useState<'floating' | 'docked'>('docked')
    const [aiChatOpen, setAiChatOpen] = useState(false)
    const [aiChatDockSide, setAiChatDockSide] = useState<'left' | 'right'>('right')
    const [aiChatWidthLeft, setAiChatWidthLeft] = useState(400)
    const [aiChatWidthRight, setAiChatWidthRight] = useState(400)
    const [isAiChatResizing, setIsAiChatResizing] = useState(false)

    const aiChatResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null)
    const aiChatFirstSaveRef = useRef(true)
    const aiChatPrevDockSideRef = useRef<'left' | 'right'>(aiChatDockSide)

    const aiChatWidth = aiChatDockSide === 'left' ? aiChatWidthLeft : aiChatWidthRight

    // AI Chat Persistence：使用 localStorage 记住模式 / 位置 / 打开状态 / 左右宽度
    useEffect(() => {
        try {
            if (typeof localStorage === 'undefined') return

            const storedMode = localStorage.getItem(STORAGE_AI_MODE)
            const storedDockSide = localStorage.getItem(STORAGE_AI_DOCK_SIDE)
            const storedOpen = localStorage.getItem(STORAGE_AI_OPEN)
            const storedLeft = localStorage.getItem(STORAGE_AI_WIDTH_LEFT)
            const storedRight = localStorage.getItem(STORAGE_AI_WIDTH_RIGHT)

            if (storedMode === 'floating' || storedMode === 'docked') {
                setAiChatMode(storedMode as 'floating' | 'docked')
            }
            if (storedDockSide === 'left' || storedDockSide === 'right') {
                setAiChatDockSide(storedDockSide as 'left' | 'right')
            }
            if (storedOpen != null) {
                setAiChatOpen(storedOpen === 'true')
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
            localStorage.setItem(STORAGE_AI_OPEN, String(aiChatOpen))
            localStorage.setItem(STORAGE_AI_WIDTH_LEFT, String(aiChatWidthLeft))
            localStorage.setItem(STORAGE_AI_WIDTH_RIGHT, String(aiChatWidthRight))
        } catch (e) {
            console.error('Failed to save AI Chat state to localStorage', e)
        }
    }, [aiChatMode, aiChatDockSide, aiChatOpen, aiChatWidthLeft, aiChatWidthRight])

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
            setAiChatWidthLeft(aiChatWidthRight)
        } else {
            setAiChatWidthRight(aiChatWidthLeft)
        }

        aiChatPrevDockSideRef.current = aiChatDockSide
    }, [aiChatDockSide, aiChatWidthLeft, aiChatWidthRight])

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

    const handleAiChatResizeStart = useCallback((event: any) => {
        const currentWidth = aiChatDockSide === 'left' ? aiChatWidthLeft : aiChatWidthRight
        aiChatResizeStateRef.current = { startX: event.clientX, startWidth: currentWidth }
        setIsAiChatResizing(true)
        event.preventDefault()
        event.stopPropagation()
    }, [aiChatDockSide, aiChatWidthLeft, aiChatWidthRight])




    return {
        aiChatState,
        aiChatMode,
        setAiChatMode,
        aiChatOpen,
        aiChatDockSide,
        setAiChatDockSide,
        aiChatWidth,
        isAiChatResizing,
        openAiChatDialog,
        closeAiChatDialog,
        handleAiChatResizeStart,
        isAiChatActuallyOpen,
    }
}
