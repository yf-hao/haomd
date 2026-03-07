import { useCallback, useEffect, useState } from 'react'
import './App.css'
import WorkspaceShell, { type LeftPanelId, type InitialWorkspaceAction } from './components/WorkspaceShell'
import { AiSettingsDialog } from './components/AiSettingsDialog'
import { PromptSettingsDialog } from './components/PromptSettingsDialog'
import { onMenuAction } from './modules/platform/menuEvents'
import { isTauriEnv } from './modules/platform/runtime'

const appStartTime = performance.now()

function App() {
  const [activeLeftPanel, setActiveLeftPanel] = useState<LeftPanelId>(null)
  const [initialWorkspaceAction, setInitialWorkspaceAction] = useState<InitialWorkspaceAction>(null)
  const [initialOpenRecentPath, setInitialOpenRecentPath] = useState<string | null>(null)
  const [initialOpenRecentIsFolder, setInitialOpenRecentIsFolder] = useState<boolean | null>(null)
  const [isAiSettingsOpen, setAiSettingsOpen] = useState(false)
  const [isPromptSettingsOpen, setPromptSettingsOpen] = useState(false)
  const [isStatusBarVisible, setStatusBarVisible] = useState(true)

  const handleLeftPanelToggle = useCallback(
    (id: LeftPanelId) => {
      setActiveLeftPanel((prev) => (prev === id ? null : id))
    },
    [],
  )

  const handleInitialActionHandled = useCallback(() => {
    setInitialWorkspaceAction(null)
    setInitialOpenRecentPath(null)
    setInitialOpenRecentIsFolder(null)
  }, [])

  // 监听 Tauri 菜单：在任意阶段响应 AI 设置相关菜单，其余命令交给 WorkspaceShell 内部处理
  useEffect(() => {
    if (!isTauriEnv()) return

    const unlistenAction = onMenuAction((actionId) => {
      if (actionId === 'ai_settings') {
        setAiSettingsOpen(true)
        return
      }
      if (actionId === 'ai_prompt_settings') {
        setPromptSettingsOpen(true)
        return
      }
      if (actionId === 'toggle_status_bar') {
        setStatusBarVisible((prev) => !prev)
        return
      }
    })

    return () => {
      unlistenAction()
    }
  }, [])

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('[Perf] App first render cost:', performance.now() - appStartTime, 'ms')
    }
  }, [])

  return (
    <div className="app-shell">
      <div className="layout-row">
        <div className="activity-bar">
          <button
            type="button"
            className={`activity-item ${activeLeftPanel === 'files' ? 'active' : ''}`}
            onClick={() => handleLeftPanelToggle('files')}
            aria-pressed={activeLeftPanel === 'files'}
            title="Files"
          >
            <span className="activity-icon-file" aria-hidden="true" />
          </button>

          <button
            type="button"
            className={`activity-item ${activeLeftPanel === 'outline' ? 'active' : ''}`}
            onClick={() => handleLeftPanelToggle('outline')}
            aria-pressed={activeLeftPanel === 'outline'}
            title="Outline"
          >
            <span className="activity-icon-outline" aria-hidden="true" />
          </button>

          <button
            type="button"
            className={`activity-item ${activeLeftPanel === 'pdf' ? 'active' : ''}`}
            onClick={() => handleLeftPanelToggle('pdf')}
            aria-pressed={activeLeftPanel === 'pdf'}
            title="PDF"
          >
            <span className="activity-icon-pdf" aria-hidden="true" />
          </button>

          <button
            type="button"
            className={`activity-item ${activeLeftPanel === 'sessions' ? 'active' : ''}`}
            onClick={() => handleLeftPanelToggle('sessions')}
            aria-pressed={activeLeftPanel === 'sessions'}
            title="会话管理"
          >
            <span className="activity-icon-sessions" aria-hidden="true" />
          </button>
        </div>

        <WorkspaceShell
          activeLeftPanel={activeLeftPanel}
          isTauriEnv={isTauriEnv}
          initialAction={initialWorkspaceAction}
          initialOpenRecentPath={initialOpenRecentPath}
          initialOpenRecentIsFolder={initialOpenRecentIsFolder}
          onInitialActionHandled={handleInitialActionHandled}
        />
      </div>

      {isStatusBarVisible && (
        <div className="status-bar">
          <div className="status-bar-left">HaoMD · AI Markdown</div>
          <div className="status-bar-right">&nbsp;</div>
        </div>
      )}

      <AiSettingsDialog open={isAiSettingsOpen} onClose={() => setAiSettingsOpen(false)} />
      <PromptSettingsDialog open={isPromptSettingsOpen} onClose={() => setPromptSettingsOpen(false)} />
    </div>
  )
}

export default App
