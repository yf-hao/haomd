import { useEffect, useRef } from 'react'

export function useMessageAutoScroll(messageCount: number) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const shouldFollowRef = useRef(true)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleScroll = () => {
      const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight
      shouldFollowRef.current = distanceToBottom <= 24
    }

    container.addEventListener('scroll', handleScroll)
    handleScroll()
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !shouldFollowRef.current) return
    const raf = window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight
    })
    return () => window.cancelAnimationFrame(raf)
  }, [messageCount])

  return containerRef
}
