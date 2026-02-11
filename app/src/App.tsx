import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './App.css'
import { Welcome } from './components/Welcome'
import WorkspaceShell, { type LeftPanelId, type InitialWorkspaceAction } from './components/WorkspaceShell'
import { AiSettingsDialog } from './components/AiSettingsDialog'
import { PromptSettingsDialog } from './components/PromptSettingsDialog'
import { onMenuAction, onOpenRecentFile } from './modules/platform/menuEvents'
import { isTauriEnv } from './modules/platform/runtime'

const appStartTime = performance.now()

function App() {
  const [activeLeftPanel, setActiveLeftPanel] = useState<LeftPanelId>(null)
  const [hasWorkspace, setHasWorkspace] = useState(false)
  const [initialWorkspaceAction, setInitialWorkspaceAction] = useState<InitialWorkspaceAction>(null)
  const [initialOpenRecentPath, setInitialOpenRecentPath] = useState<string | null>(null)
  const [initialOpenRecentIsFolder, setInitialOpenRecentIsFolder] = useState<boolean | null>(null)
  const [isAiSettingsOpen, setAiSettingsOpen] = useState(false)
  const [isPromptSettingsOpen, setPromptSettingsOpen] = useState(false)

  const handleLeftPanelToggle = useCallback(
    (id: LeftPanelId) => {
      setActiveLeftPanel((prev) => (prev === id ? null : id))

      // 欢迎页阶段点击 Files 图标：轻量进入工作区（内部 Welcome 接管后续行为）
      if (!hasWorkspace && id === 'files') {
        setHasWorkspace(true)
      }
    },
    [hasWorkspace],
  )

  const handleWelcomeNewFile = useCallback(() => {
    setHasWorkspace(true)
    setInitialWorkspaceAction('new')
  }, [])

  const handleWelcomeOpenFile = useCallback(() => {
    setHasWorkspace(true)
    setInitialWorkspaceAction('open')
  }, [])

  const handleInitialActionHandled = useCallback(() => {
    setInitialWorkspaceAction(null)
    setInitialOpenRecentPath(null)
    setInitialOpenRecentIsFolder(null)
  }, [])

  // 轻量监听 Tauri 菜单：仅在尚未进入工作区时拦截 File 菜单的新建/打开/打开文件夹/打开最近/退出
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

      if (hasWorkspace) return
      if (actionId === 'new_file') {
        setHasWorkspace(true)
        setInitialWorkspaceAction('new')
      } else if (actionId === 'open_file') {
        setHasWorkspace(true)
        setInitialWorkspaceAction('open')
      } else if (actionId === 'open_folder') {
        setHasWorkspace(true)
        setInitialWorkspaceAction('open_folder')
      } else if (actionId === 'quit') {
        // 欢迎页阶段的 Quit：直接退出应用
        void invoke('quit_app')
      }
    })

    const unlistenRecent = onOpenRecentFile(({ path, isFolder }) => {
      if (hasWorkspace) return
      setInitialOpenRecentPath(path)
      setInitialOpenRecentIsFolder(isFolder)
      setHasWorkspace(true)
      setInitialWorkspaceAction('open_recent')
    })

    return () => {
      unlistenAction()
      unlistenRecent()
    }
  }, [hasWorkspace])

  if (import.meta.env.DEV) {
    console.log('[Perf] App first render cost:', performance.now() - appStartTime, 'ms')
  }

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
        </div>

        {!hasWorkspace ? (
          <div className="workspace-column">
            <Welcome onNewFile={handleWelcomeNewFile} onOpenFile={handleWelcomeOpenFile} />
          </div>
        ) : (
          <WorkspaceShell
            activeLeftPanel={activeLeftPanel}
            isTauriEnv={isTauriEnv}
            initialAction={initialWorkspaceAction}
            initialOpenRecentPath={initialOpenRecentPath}
            initialOpenRecentIsFolder={initialOpenRecentIsFolder}
            onInitialActionHandled={handleInitialActionHandled}
          />
        )}
      </div>

      <div className="bottom-bar">
        <div className="bottom-bar-left">Markdown Workspace</div>
        <div className="bottom-bar-right">&nbsp;</div>
      </div>

      <AiSettingsDialog open={isAiSettingsOpen} onClose={() => setAiSettingsOpen(false)} />
      <PromptSettingsDialog open={isPromptSettingsOpen} onClose={() => setPromptSettingsOpen(false)} />
    </div>
  )
}

export default App
