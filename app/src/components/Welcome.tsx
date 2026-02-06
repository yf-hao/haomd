import logo from '../assets/logo.png'
export interface WelcomeProps {
  onNewFile: () => void
  onOpenFile: () => void
}

export function Welcome({ onNewFile, onOpenFile }: WelcomeProps) {
  return (
    <div className="welcome">
      <div className="welcome-content">
        <div className="welcome-logo">
          <div className="logo-mark">
             <img src={logo} alt="HaoMD Logo" />
          </div>
          <div className="logo-title">HaoMD</div>
        </div>

        <p className="welcome-subtitle">Powered by AI, this Markdown editor intelligently optimizes your text, offers smart writing suggestions, and helps you quickly produce well-structured, perfectly formatted documents.</p>

        <div className="welcome-actions">
          <button className="welcome-button primary" onClick={onNewFile}>
            New File
            
          </button>

          <button className="welcome-button secondary" onClick={onOpenFile}>
            Open File
         
          </button>
        </div>
      </div>
    </div>
  )
}
