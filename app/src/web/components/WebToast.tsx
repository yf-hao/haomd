import type { WebToastState } from '../hooks/useWebToast'

export function WebToast({ toast }: { toast: WebToastState }) {
  if (!toast) return null

  return (
    <div className={`web-toast web-toast-${toast.tone}`} role="status" aria-live="polite">
      {toast.message}
    </div>
  )
}
