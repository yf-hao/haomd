import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { ChatMessageView } from '../domain/chatSession'
import { prefetchMarkdownPreviews } from '../../markdown/markdownPreviewWorkerClient'

const DEFAULT_MESSAGE_HEIGHT = 180
const MIN_OVERSCAN_HEIGHT = 600
const OVERSCAN_VIEWPORT_MULTIPLIER = 1.5
const PREFETCH_MESSAGE_COUNT = 8
export const AI_CHAT_VIRTUALIZATION_THRESHOLD = 12
export const AI_CHAT_VIRTUALIZATION_CONTENT_THRESHOLD = 12_000

export function shouldVirtualizeAiChatMessages(messages: ChatMessageView[]): boolean {
  if (messages.length > AI_CHAT_VIRTUALIZATION_THRESHOLD) return true
  return messages.reduce((total, message) => total + message.content.length, 0)
    >= AI_CHAT_VIRTUALIZATION_CONTENT_THRESHOLD
}

function estimateMessageHeight(message: ChatMessageView): number {
  const estimatedLines = Math.ceil(message.content.length / 90)
  return Math.min(1_600, Math.max(DEFAULT_MESSAGE_HEIGHT, 96 + estimatedLines * 22))
}

type MessagePosition = {
  id: string
  top: number
  height: number
}

type ScrollAnchor = {
  id: string
  top: number
}

type VirtualMessageListProps = {
  messages: ChatMessageView[]
  containerRef: RefObject<HTMLDivElement>
  renderMessage: (message: ChatMessageView) => ReactNode
  initialScrollKey?: string
}

function findFirstPosition(positions: MessagePosition[], offset: number): number {
  let low = 0
  let high = positions.length - 1

  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const position = positions[middle]
    if (!position || position.top + position.height < offset) {
      low = middle + 1
    } else {
      high = middle
    }
  }

  return low
}

export function AiChatVirtualMessageList({
  messages,
  containerRef,
  renderMessage,
  initialScrollKey = 'ai-chat',
}: VirtualMessageListProps) {
  const rowElementsRef = useRef(new Map<string, HTMLElement>())
  const scrollFrameRef = useRef<number | null>(null)
  const pinToBottomRef = useRef(false)
  const lastScrollTopRef = useRef(0)
  const scrollAnchorRef = useRef<ScrollAnchor | null>(null)
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 })
  const [measuredHeights, setMeasuredHeights] = useState(() => new Map<string, number>())
  const [initializedScrollKey, setInitializedScrollKey] = useState<string | null>(null)

  const updateViewport = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    setViewport((previous) => {
      const next = {
        scrollTop: container.scrollTop,
        height: container.clientHeight,
      }
      return previous.scrollTop === next.scrollTop && previous.height === next.height
        ? previous
        : next
    })
  }, [containerRef])

  const captureScrollAnchor = useCallback(() => {
    if (pinToBottomRef.current || scrollAnchorRef.current) return

    const container = containerRef.current
    if (!container) return

    const containerRect = container.getBoundingClientRect()
    for (const [id, element] of rowElementsRef.current) {
      const rect = element.getBoundingClientRect()
      if (rect.bottom <= containerRect.top || rect.top >= containerRect.bottom) continue
      scrollAnchorRef.current = {
        id,
        top: rect.top - containerRect.top,
      }
      return
    }
  }, [containerRef])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleScroll = () => {
      const nextScrollTop = container.scrollTop
      const isScrollingUp = nextScrollTop < lastScrollTopRef.current - 0.5
      pinToBottomRef.current = !isScrollingUp
        && container.scrollHeight - nextScrollTop - container.clientHeight <= 80
      lastScrollTopRef.current = nextScrollTop
      if (scrollFrameRef.current !== null) return
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null
        updateViewport()
      })
    }

    updateViewport()
    container.addEventListener('scroll', handleScroll, { passive: true })

    let resizeObserver: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(updateViewport)
      resizeObserver.observe(container)
    }

    return () => {
      container.removeEventListener('scroll', handleScroll)
      resizeObserver?.disconnect()
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current)
        scrollFrameRef.current = null
      }
    }
  }, [containerRef, updateViewport])

  const positions = useMemo(() => {
    return messages.reduce<MessagePosition[]>((result, message) => {
      const previous = result[result.length - 1]
      const top = previous ? previous.top + previous.height : 0
      const height = measuredHeights.get(message.id) ?? estimateMessageHeight(message)
      result.push({ id: message.id, top, height })
      return result
    }, [])
  }, [messages, measuredHeights])

  const totalHeight = positions.at(-1)
    ? positions[positions.length - 1]!.top + positions[positions.length - 1]!.height
    : 0
  const viewportHeight = viewport.height || MIN_OVERSCAN_HEIGHT
  const isInitialScrollPending = initializedScrollKey !== initialScrollKey
  const effectiveScrollTop = isInitialScrollPending
    ? Math.max(0, totalHeight - viewportHeight)
    : viewport.scrollTop
  const overscan = Math.max(MIN_OVERSCAN_HEIGHT, viewportHeight * OVERSCAN_VIEWPORT_MULTIPLIER)
  const firstVisibleOffset = Math.max(0, effectiveScrollTop - overscan)
  const lastVisibleOffset = effectiveScrollTop + viewportHeight + overscan
  const firstIndex = positions.length ? findFirstPosition(positions, firstVisibleOffset) : 0
  const lastIndex = positions.length
    ? Math.min(positions.length - 1, findFirstPosition(positions, lastVisibleOffset) + 1)
    : -1

  const setRowElement = useCallback((id: string, element: HTMLElement | null) => {
    if (element) {
      rowElementsRef.current.set(id, element)
    } else {
      rowElementsRef.current.delete(id)
    }
  }, [])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (
      container
      && messages.length > 0
      && initializedScrollKey !== initialScrollKey
    ) {
      container.scrollTop = Math.max(0, totalHeight - container.clientHeight)
      setInitializedScrollKey(initialScrollKey)
      pinToBottomRef.current = true
      lastScrollTopRef.current = container.scrollTop
      scrollAnchorRef.current = null
      updateViewport()
    }
  }, [containerRef, initialScrollKey, initializedScrollKey, messages.length, totalHeight, updateViewport])

  useLayoutEffect(() => {
    const updateHeight = (id: string, height: number) => {
      if (!Number.isFinite(height) || height <= 0) return
      setMeasuredHeights((previous) => {
        const previousHeight = previous.get(id)
        if (previousHeight != null && Math.abs(previousHeight - height) < 1) return previous
        captureScrollAnchor()
        const next = new Map(previous)
        next.set(id, height)
        return next
      })
    }

    for (const [id, element] of rowElementsRef.current) {
      updateHeight(id, element.getBoundingClientRect().height)
    }

    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const id = entry.target.getAttribute('data-ai-message-id')
        if (!id) continue
        updateHeight(id, entry.contentRect.height)
      }
    })

    for (const element of rowElementsRef.current.values()) {
      observer.observe(element)
    }

    return () => observer.disconnect()
  }, [captureScrollAnchor, firstIndex, lastIndex, messages.length])

  useLayoutEffect(() => {
    const anchor = scrollAnchorRef.current
    const container = containerRef.current
    if (!anchor || !container) return

    scrollAnchorRef.current = null
    if (pinToBottomRef.current) return

    const element = rowElementsRef.current.get(anchor.id)
    if (!element) return

    const containerRect = container.getBoundingClientRect()
    const currentTop = element.getBoundingClientRect().top - containerRect.top
    const delta = currentTop - anchor.top
    if (Math.abs(delta) < 0.5) return

    container.scrollTop += delta
    lastScrollTopRef.current = container.scrollTop
    updateViewport()
  }, [containerRef, measuredHeights, updateViewport])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container || !pinToBottomRef.current) return
    container.scrollTop = container.scrollHeight
    updateViewport()
  }, [containerRef, measuredHeights, updateViewport])

  const renderedMessages = firstIndex <= lastIndex
    ? messages.slice(firstIndex, lastIndex + 1)
    : []
  const prefetchValues = useMemo(() => (
    messages
      .slice(
        Math.max(0, firstIndex - PREFETCH_MESSAGE_COUNT),
        Math.min(messages.length, lastIndex + PREFETCH_MESSAGE_COUNT + 1),
      )
      .filter((message) => message.role === 'assistant' && !message.streaming && message.content.trim())
      .map((message) => message.content)
  ), [firstIndex, lastIndex, messages])

  useEffect(() => {
    if (prefetchValues.length === 0) return
    const controller = new AbortController()
    prefetchMarkdownPreviews(prefetchValues, { signal: controller.signal })
    return () => controller.abort()
  }, [prefetchValues])

  const topSpacerHeight = positions[firstIndex]?.top ?? 0
  const renderedBottom = lastIndex >= 0
    ? positions[lastIndex]!.top + positions[lastIndex]!.height
    : 0
  const bottomSpacerHeight = Math.max(0, totalHeight - renderedBottom)

  return (
    <div className="ai-chat-virtual-message-list" style={{ minHeight: totalHeight }}>
      <div aria-hidden="true" style={{ height: topSpacerHeight }} />
      {renderedMessages.map((message) => (
        <div
          key={message.id}
          ref={(element) => setRowElement(message.id, element)}
          data-ai-message-id={message.id}
          className="ai-chat-virtual-message-row"
        >
          {renderMessage(message)}
        </div>
      ))}
      <div aria-hidden="true" style={{ height: bottomSpacerHeight }} />
    </div>
  )
}
