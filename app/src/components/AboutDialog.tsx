import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { getName, getVersion, getTauriVersion } from '@tauri-apps/api/app'
import { platform, arch, version as osVersion } from '@tauri-apps/api/os'

export type AboutDialogProps = {
  open: boolean
  onClose: () => void
}

type AboutInfo = {
  appName: string
  version: string
  tauriVersion: string
  osDescription: string
}

const DEFAULT_APP_NAME = 'HaoMD'

export const AboutDialog: FC<AboutDialogProps> = ({ open, onClose }) => {
  const [info, setInfo] = useState<AboutInfo>({
    appName: DEFAULT_APP_NAME,
    version: '',
    tauriVersion: '',
    osDescription: '',
  })
  const [copyLabel, setCopyLabel] = useState<'Copy' | 'Copied'>('Copy')

  useEffect(() => {
    if (!open) return

    let cancelled = false

    ;(async () => {
      try {
        const [name, version, tauri, osPlat, osArch, osVer] = await Promise.all([
          getName().catch(() => DEFAULT_APP_NAME),
          getVersion().catch(() => ''),
          getTauriVersion().catch(() => ''),
          platform().catch(() => ''),
          arch().catch(() => ''),
          osVersion().catch(() => ''),
        ])

        if (cancelled) return

        const osDescription = osPlat && osArch && osVer
          ? `${osPlat.charAt(0).toUpperCase()}${osPlat.slice(1)} ${osArch} ${osVer}`
          : ''

        setInfo({
          appName: name || DEFAULT_APP_NAME,
          version,
          tauriVersion: tauri,
          osDescription,
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
    if (info.osDescription) {
      lines.push(`OS: ${info.osDescription}`)
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
          <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-line', textAlign: 'center' }}>
            {info.version && <div>Version: {info.version}</div>}
            {info.tauriVersion && <div>Tauri: {info.tauriVersion}</div>}
            {info.osDescription && <div>OS: {info.osDescription}</div>}
            <div style={{ marginTop: 8 }}>
              <div>React: 19.2.4</div>
              <div>TypeScript: 5.9.3</div>
              <div>Vite: 7.2.5</div>
              <div>PDF.js: 5.4.624</div>
              <div>Mermaid: 11.12.2</div>
              <div>CodeMirror: 6.x</div>
              <div>MindElixir: 5.8.0</div>
              <div>React Markdown: 10.1.0</div>
              <div>KaTeX: 0.16.28</div>
            </div>
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
