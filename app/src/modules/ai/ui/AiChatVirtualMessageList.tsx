import { chatScrollController } from './chatScrollController'
import { chatScrollDebug } from './chatScrollDebug'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { ChatMessageView } from '../domain/chatSession'
import { prefetchMarkdownPreviews } from '../../markdown/markdownPreviewWorkerClient'

const DEFAULT_MESSAGE_HEIGHT = 180
const MIN_OVERSCAN_HEIGHT = 600
const OVERSCAN_VIEWPORT_MULTIPLIER = 1.5
const PREFETCH_MESSAGE_COUNT = 8
export const AI_CHAT_VIRTUALIZATION_THRESHOLD = 12

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
  initialAnchor?: { id: string; top: number } | null
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
  initialAnchor,
}: VirtualMessageListProps) {
  const rowElementsRef = useRef(new Map<string, HTMLElement>())
  const scrollFrameRef = useRef<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const positionsRef = useRef<MessagePosition[]>([])
  const heightsRef = useRef(new Map<string, number>())
  const scrollAnchorRef = useRef<ScrollAnchor | null>(null)
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0, following: true })
  const [measuredHeights, setMeasuredHeights] = useState(() => new Map<string, number>())
  const [initializedScrollKey, setInitializedScrollKey] = useState<string | null>(null)

  const updateViewport = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    setViewport((previous) => {
      const next = {
        scrollTop: container.scrollTop,
        height: container.clientHeight,
        following: chatScrollController(container).follow.current,
      }
      return previous.scrollTop === next.scrollTop && previous.height === next.height && previous.following === next.following
        ? previous
        : next
    })
  }, [containerRef])

  const captureScrollAnchor = useCallback(() => {
    const container = containerRef.current
    const list = listRef.current
    if (!container || !list || chatScrollController(container).follow.current || scrollAnchorRef.current) return
    const origin = list.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
    const position = positionsRef.current.find(row => origin + row.top + row.height > container.scrollTop)
    if (position) scrollAnchorRef.current = { id: position.id, top: origin + position.top - container.scrollTop }
  }, [containerRef])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleScroll = () => {
      // A fresh user position supersedes any pending compensation anchor.
      scrollAnchorRef.current = null
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
      let width = container.clientWidth
      resizeObserver = new ResizeObserver(() => {
        if (Math.abs(container.clientWidth - width) > 1) {
          width = container.clientWidth
          captureScrollAnchor()
          const next = new Map<string, number>()
          for (const [id, element] of rowElementsRef.current) {
            const height = element.getBoundingClientRect().height
            if (height > 0) next.set(id, height)
          }
          heightsRef.current = next
          setMeasuredHeights(next)
        }
        updateViewport()
      })
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
  }, [containerRef, updateViewport, captureScrollAnchor])

  const positions = useMemo(() => {
    return messages.reduce<MessagePosition[]>((result, message) => {
      const previous = result[result.length - 1]
      const top = previous ? previous.top + previous.height : 0
      const height = measuredHeights.get(message.id) ?? DEFAULT_MESSAGE_HEIGHT
      result.push({ id: message.id, top, height })
      return result
    }, [])
  }, [messages, measuredHeights])

  const totalHeight = positions.at(-1)
    ? positions[positions.length - 1]!.top + positions[positions.length - 1]!.height
    : 0
  const viewportHeight = viewport.height || MIN_OVERSCAN_HEIGHT
  const isInitialScrollPending = initializedScrollKey !== initialScrollKey
    && viewport.following
  const anchorPosition = initializedScrollKey !== initialScrollKey && initialAnchor
    ? positions.find(row => row.id === initialAnchor.id) : undefined
  const effectiveScrollTop = anchorPosition && initialAnchor ? Math.max(0, anchorPosition.top - initialAnchor.top) : isInitialScrollPending
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
      if (chatScrollController(container).follow.current) {
        chatScrollDebug('virtual list initial bottom', container, { totalHeight, messageCount: messages.length })
        chatScrollController(container).write(Math.max(0, totalHeight - container.clientHeight), 'VirtualList.initialBottom')
      }
      if (anchorPosition && initialAnchor && !chatScrollController(container).follow.current) {
        chatScrollDebug('virtual list initial anchor restore', container, { id: initialAnchor.id, anchorPosition: anchorPosition.top, anchorTop: initialAnchor.top })
        chatScrollController(container).write(Math.max(0, anchorPosition.top - initialAnchor.top), 'VirtualList.initialAnchor')
      }
      setInitializedScrollKey(initialScrollKey)
      scrollAnchorRef.current = !chatScrollController(container).follow.current ? initialAnchor ?? null : null
      updateViewport()
    }
  }, [containerRef, initialScrollKey, initializedScrollKey, messages.length, totalHeight, updateViewport, anchorPosition, initialAnchor])

  useLayoutEffect(() => {
    let frame: number | null = null
    const measure = () => {
      frame = null
      const next = new Map(heightsRef.current)
      let changed = false
      for (const [id, element] of rowElementsRef.current) {
        const height = element.getBoundingClientRect().height
        if (height > 0 && Number.isFinite(height) && Math.abs((next.get(id) ?? 0) - height) >= 1) {
          next.set(id, height)
          changed = true
        }
      }
      if (!changed) return
      chatScrollDebug('virtual list measured row heights', containerRef.current, { changedRows: [...next].filter(([id, height]) => heightsRef.current.get(id) !== height).length, mountedRows: rowElementsRef.current.size, messageCount: messages.length })
      captureScrollAnchor()
      heightsRef.current = next
      setMeasuredHeights(next)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (frame === null) frame = requestAnimationFrame(measure)
    })
    for (const element of rowElementsRef.current.values()) observer.observe(element)
    return () => { observer.disconnect(); if (frame !== null) cancelAnimationFrame(frame) }
  }, [captureScrollAnchor, firstIndex, lastIndex, messages.length, initialScrollKey])

  useLayoutEffect(() => {
    const anchor = scrollAnchorRef.current
    const container = containerRef.current
    if (!anchor || !container || measuredHeights !== heightsRef.current) return

    scrollAnchorRef.current = null
    if (chatScrollController(container).follow.current) return

    const position = positions.find(row => row.id === anchor.id)
    const list = listRef.current
    if (!position || !list) return
    const origin = list.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
    const top = origin + position.top - anchor.top
    if (Math.abs(top - container.scrollTop) < 0.5) return
    chatScrollDebug('virtual list height anchor compensation', container, { id: anchor.id, anchorTop: anchor.top, targetTop: top })
    chatScrollController(container).write(top, 'VirtualList.heightAnchor')
    updateViewport()
  }, [containerRef, measuredHeights, positions, updateViewport])

  useLayoutEffect(() => {
    const container = containerRef.current
    positionsRef.current = positions
    if (container) chatScrollController(container).scheduleBottom()
  }, [containerRef, measuredHeights, positions])

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
  ), [firstIndex, lastIndex, messages.length, initialScrollKey])

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
    <div ref={listRef} className="ai-chat-virtual-message-list" style={{ minHeight: totalHeight }}>
      <div aria-hidden="true" style={{ height: topSpacerHeight }} />
      {renderedMessages.map((message) => (
        <div
          key={message.id}
          ref={(element) => setRowElement(message.id, element)}
          data-ai-message-id={message.id}
          className="ai-chat-virtual-message-row"
          style={{ display: 'flow-root' }}
        >
          {renderMessage(message)}
        </div>
      ))}
      <div aria-hidden="true" style={{ height: bottomSpacerHeight }} />
    </div>
  )
}
