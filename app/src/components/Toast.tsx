import { memo, useEffect, useRef, useState } from 'react'
import './Toast.css'

interface ToastProps {
  message: string
  onDismiss: () => void
  duration?: number
}

const Toast = memo(({ message, onDismiss, duration = 3000 }: ToastProps) => {
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!message) {
      setVisible(false)
      return
    }
    setVisible(true)

    if (timerRef.current != null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      setVisible(false)
      window.setTimeout(onDismiss, 300) // wait for fade-out animation
    }, duration)

    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current)
    }
  }, [message, duration, onDismiss])

  if (!message) return null

  return (
    <div className={`toast-notification ${visible ? 'toast-visible' : 'toast-hidden'}`}>
      {message}
    </div>
  )
})

export default Toast
