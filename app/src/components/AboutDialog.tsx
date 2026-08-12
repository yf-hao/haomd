import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import { useI18n } from '../modules/i18n/I18nContext'

export type AboutDialogProps = {
  open: boolean
  onClose: () => void
}

type AboutInfo = {
  version: string
}

export const AboutDialog: FC<AboutDialogProps> = ({ open, onClose }) => {
  const { t } = useI18n()
  const [info, setInfo] = useState<AboutInfo>({
    version: '',
  })

  useEffect(() => {
    if (!open) return

    let cancelled = false

    ;(async () => {
      try {
        const version = await getVersion().catch(() => '')

        if (cancelled) return

        setInfo({
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
            alt={`${t('app.name')} Logo`}
            style={{ width: 64, height: 64, borderRadius: 12, marginBottom: 12 }}
          />
          <div style={{ fontSize: 32, marginBottom: 8 }}>{t('app.name')}</div>
        </div>
        <div className="modal-content" style={{ paddingTop: 0 }}>
          <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-line', textAlign: 'center' }}>
            {info.version && <div>Version: {info.version}</div>}
          </div>
        </div>
        <div className="modal-actions">
          <button className="ghost primary" type="button" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
