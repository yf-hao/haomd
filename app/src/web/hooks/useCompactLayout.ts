import { useEffect, useState } from 'react'

const COMPACT_MEDIA_QUERY = '(max-width: 860px)'

function getMatches(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(COMPACT_MEDIA_QUERY).matches
}

export function useCompactLayout() {
  const [compact, setCompact] = useState<boolean>(() => getMatches())

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(COMPACT_MEDIA_QUERY)
    const handleChange = (event: MediaQueryListEvent) => setCompact(event.matches)
    setCompact(media.matches)
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  return compact
}
