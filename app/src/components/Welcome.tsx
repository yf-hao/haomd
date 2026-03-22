import logo from '../assets/logo.png'
import './Welcome.css'
import { useI18n } from '../modules/i18n/I18nContext'
export interface WelcomeProps {
  onNewFile: () => void
  onOpenFile: () => void
  onOpenAiChat?: () => void
}

export function Welcome({ onNewFile, onOpenFile, onOpenAiChat }: WelcomeProps) {
  const { t } = useI18n()

  return (
    <div className="welcome">
      <div className="welcome-content">
        <div className="welcome-logo">
          <div className="logo-mark">
             <img src={logo} alt="HaoMD Logo" />
          </div>
          <div className="logo-title">HaoMD</div>
        </div>

        <p className="welcome-subtitle">{t('welcome.subtitle')}</p>

        <div className="welcome-actions">
          <button className="welcome-button secondary" onClick={onNewFile}>
            {t('welcome.newFile')}
          </button>

          <button className="welcome-button secondary" onClick={onOpenFile}>
            {t('welcome.openFile')}
          </button>

          {onOpenAiChat && (
            <button
              className="welcome-button secondary"
              onClick={onOpenAiChat}
            >
              {t('welcome.openAiChat')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
