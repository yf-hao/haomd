import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { getName, getVersion, getTauriVersion } from '@tauri-apps/api/app'

export type AboutDialogProps = {
  open: boolean
  onClose: () => void
}

type AboutInfo = {
  appName: string
  version: string
  tauriVersion: string
}

const DEFAULT_APP_NAME = 'HaoMD'

export const AboutDialog: FC<AboutDialogProps> = ({ open, onClose }) => {
  const [info, setInfo] = useState<AboutInfo>({
    appName: DEFAULT_APP_NAME,
    version: '',
    tauriVersion: '',
  })
  const [copyLabel, setCopyLabel] = useState<'Copy' | 'Copied'>('Copy')

  useEffect(() => {
    if (!open) return

    let cancelled = false

    ;(async () => {
      try {
        const [name, version, tauri] = await Promise.all([
          getName().catch(() => DEFAULT_APP_NAME),
          getVersion().catch(() => ''),
          getTauriVersion().catch(() => ''),
        ])

        if (cancelled) return

        setInfo({
          appName: name || DEFAULT_APP_NAME,
          version,
          tauriVersion: tauri,
        })
      } catch (err) {
        console.error('[AboutDialog] failed to load app info', err)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open])

  const infoText = useMemo(() => {
    const lines: string[] = []
    lines.push(info.appName || DEFAULT_APP_NAME)
    lines.push('')
    if (info.version) {
      lines.push(`Version: ${info.version}`)
    }
    if (info.tauriVersion) {
      lines.push(`Tauri: ${info.tauriVersion}`)
    }
    return lines.join('\n')
  }, [info])

  const handleCopy = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(infoText)
        setCopyLabel('Copied')
        setTimeout(() => setCopyLabel('Copy'), 1500)
      }
    } catch (err) {
      console.warn('[AboutDialog] copy failed', err)
    }
  }

  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-ai-settings" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title" style={{ textAlign: 'center' }}>
          <img
            src={new URL('../assets/logo.png', import.meta.url).href}
            alt="HaoMD Logo"
            style={{ width: 64, height: 64, borderRadius: 12, marginBottom: 12 }}
          />
          <div style={{ fontSize: 32, marginBottom: 8 }}>{info.appName || DEFAULT_APP_NAME}</div>
        </div>
        <div className="modal-content" style={{ paddingTop: 0 }}>
          <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-line' }}>
            {info.version && <div>Version: {info.version}</div>}
            {info.tauriVersion && <div>Tauri: {info.tauriVersion}</div>}
          </div>
        </div>
        <div className="modal-actions">
          <button className="ghost" type="button" onClick={onClose}>
            OK
          </button>
          <button className="ghost primary" type="button" onClick={handleCopy}>
            {copyLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
