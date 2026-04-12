import { useCallback, useEffect, useState } from 'react'

export type WebToastState = {
  id: number
  tone: 'success' | 'error' | 'info'
  message: string
} | null

export function useWebToast() {
  const [toast, setToast] = useState<WebToastState>(null)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2400)
    return () => window.clearTimeout(timer)
  }, [toast])

  const showToast = useCallback((input: {
    tone?: 'success' | 'error' | 'info'
    message: string
  }) => {
    setToast({
      id: Date.now(),
      tone: input.tone ?? 'info',
      message: input.message,
    })
  }, [])

  return {
    toast,
    showToast,
    clearToast: () => setToast(null),
  }
}
