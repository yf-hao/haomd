import logo from '../assets/logo.png'
import './Welcome.css'
import { useI18n } from '../modules/i18n/I18nContext'
export interface WelcomeProps {
  onNewFile: () => void
  onOpenFile: () => void
}

export function Welcome({ onNewFile, onOpenFile }: WelcomeProps) {
  const { t } = useI18n()

  return (
    <div className="welcome">
      <div className="welcome-content">
        <div className="welcome-logo">
          <div className="logo-mark">
             <img src={logo} alt={`${t('app.name')} Logo`} />
          </div>
          <div className="logo-title">{t('app.name')}</div>
        </div>

        <p className="welcome-subtitle">{t('welcome.subtitle')}</p>

        <div className="welcome-actions">
          <button className="welcome-button secondary" onClick={onNewFile}>
            {t('welcome.newFile')}
          </button>

          <button className="welcome-button secondary" onClick={onOpenFile}>
            {t('welcome.openFile')}
          </button>
        </div>
      </div>
    </div>
  )
}
