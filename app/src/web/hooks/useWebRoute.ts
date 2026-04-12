import { useEffect, useState } from 'react'
import { getCurrentRoute, type WebLiteRoute } from '../router'

export function useWebRoute() {
  const [route, setRoute] = useState<WebLiteRoute>(() => getCurrentRoute())

  useEffect(() => {
    const handle = () => setRoute(getCurrentRoute())
    window.addEventListener('hashchange', handle)
    return () => window.removeEventListener('hashchange', handle)
  }, [])

  return route
}
