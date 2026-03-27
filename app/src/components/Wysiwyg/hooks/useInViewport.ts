/**
 * Hook that tracks whether an element is within or near the viewport.
 * Used to defer rendering of expensive node views (Mermaid, Mind-elixir)
 * until they scroll into view.
 */
import { useEffect, useRef, useState } from 'react'

/**
 * @param rootMargin  Extra margin around viewport to pre-render nearby elements.
 *                    Default "200px" means start rendering 200px before visible.
 */
export function useInViewport(rootMargin = '200px') {
  const ref = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // If IntersectionObserver is unavailable, always render
    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          // Once visible, stop observing — diagram stays rendered
          observer.unobserve(el)
        }
      },
      { rootMargin },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [rootMargin])

  return { ref, isVisible }
}
