import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { getName, getVersion } from '@tauri-apps/api/app'

export type AboutDialogProps = {
  open: boolean
  onClose: () => void
}

type AboutInfo = {
  appName: string
  version: string
}

const DEFAULT_APP_NAME = 'HaoMD'

export const AboutDialog: FC<AboutDialogProps> = ({ open, onClose }) => {
  const [info, setInfo] = useState<AboutInfo>({
    appName: DEFAULT_APP_NAME,
    version: '',
  })

  useEffect(() => {
    if (!open) return

    let cancelled = false

    ;(async () => {
      try {
        const [name, version] = await Promise.all([
          getName().catch(() => DEFAULT_APP_NAME),
          getVersion().catch(() => ''),
        ])

        if (cancelled) return

        setInfo({
          appName: name || DEFAULT_APP_NAME,
          version,
        })
      } catch (err) {
        console.error('[AboutDialog] failed to load app info', err)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open])

  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-about" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title" style={{ textAlign: 'center' }}>
          <img
            src={new URL('../assets/logo.png', import.meta.url).href}
            alt="HaoMD Logo"
            style={{ width: 64, height: 64, borderRadius: 12, marginBottom: 12 }}
          />
          <div style={{ fontSize: 32, marginBottom: 8 }}>{info.appName || DEFAULT_APP_NAME}</div>
        </div>
        <div className="modal-content" style={{ paddingTop: 0 }}>
          <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-line', textAlign: 'center' }}>
            {info.version && <div>Version: {info.version}</div>}
          </div>
        </div>
        <div className="modal-actions">
          <button className="ghost" type="button" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
