import { useEffect, useMemo, useState } from 'react'
import type { AiSettingsState } from '../modules/ai/settings'
import type { WebLiteNote, WebLiteSettings, WebLiteSyncSettings } from './domain/models'
import { useWebRoute } from './hooks/useWebRoute'
import { useCompactLayout } from './hooks/useCompactLayout'
import { navigateTo } from './router'
import { BottomNav } from './components/BottomNav'
import { ChatListPage } from './pages/ChatListPage'
import { ChatDetailPage } from './pages/ChatDetailPage'
import { NotesListPage } from './pages/NotesListPage'
import { NoteDetailPage } from './pages/NoteDetailPage'
import { SettingsPage } from './pages/SettingsPage'
import { useWebChatSessions } from './hooks/useWebChatSessions'
import { useWebChatDetail } from './hooks/useWebChatDetail'
import { useWebNotes } from './hooks/useWebNotes'
import { notesRepoWeb } from './storage/notesRepo.web'
import { settingsRepoWeb } from './storage/settingsRepo.web'
import { chatSessionsRepoWeb } from './storage/chatSessionsRepo.web'
import { createNoteFromAssistantMessage, getLatestAssistantMessage } from './application/webNoteService'
import { createChatSessionFromNote } from './application/webNoteChatBridge'
import { downloadNoteMarkdown, readMarkdownFile } from './application/webNoteMarkdownService'
import { createWebLiteExportBundle, downloadWebLiteExportBundle, mergeWebLiteImportBundle, parseWebLiteImportBundle } from './application/webDataTransferService'
import { WebToast } from './components/WebToast'
import { useWebToast } from './hooks/useWebToast'
import { testWebProviderConnection } from './application/webProviderTestService'
import { createWebLiteSyncSnapshot, downloadWebLiteSyncSnapshot } from './application/webSyncManifestService'
import { pullWebLiteFromWebDav, pushWebLiteToWebDav, syncWebLiteWithWebDav } from './application/webWebdavSyncService'

export function AppWeb() {
  const route = useWebRoute()
  const compact = useCompactLayout()
  const { sessions, loading: sessionsLoading, createSession, deleteSession, refresh: refreshSessions, saveSession } = useWebChatSessions()
  const { notes, loading: notesLoading, createNote, deleteNote, saveNote, refresh: refreshNotes } = useWebNotes()
  const { session, loading: chatDetailLoading, sending, error, send } = useWebChatDetail(route.name === 'chat' ? route.sessionId : undefined)
  const [activeNote, setActiveNote] = useState<WebLiteNote | null>(null)
  const [settings, setSettings] = useState<WebLiteSettings | null>(null)
  const { toast, showToast } = useWebToast()

  useEffect(() => {
    void settingsRepoWeb.load().then(setSettings)
  }, [])

  useEffect(() => {
    if (route.name !== 'notes' || !route.noteId) {
      setActiveNote(null)
      return
    }
    void notesRepoWeb.getNote(route.noteId).then(setActiveNote)
  }, [route])

  const activeTab = useMemo(() => {
    if (route.name === 'notes') return 'notes'
    if (route.name === 'settings') return 'settings'
    return 'chat'
  }, [route.name])

  const handleCreateSession = async () => {
    const next = await createSession()
    navigateTo({ name: 'chat', sessionId: next.id })
  }

  const handleCreateNote = async () => {
    const next = await createNote()
    navigateTo({ name: 'notes', noteId: next.id })
  }

  const handleSaveAiSettings = async (next: AiSettingsState) => {
    await settingsRepoWeb.saveAiSettings(next)
    const latest = await settingsRepoWeb.load()
    setSettings(latest)
    showToast({ tone: 'success', message: 'AI 设置已保存' })
  }

  const handleSaveSyncSettings = async (next: WebLiteSyncSettings | null) => {
    await settingsRepoWeb.saveSyncSettings(next)
    const latest = await settingsRepoWeb.load()
    setSettings(latest)
    showToast({ tone: 'success', message: next ? '同步设置已保存' : '同步设置已清空' })
  }

  const handleTestConnection = async (input: {
    providerType: 'openai' | 'dify' | 'gemini'
    baseUrl: string
    apiKey: string
    modelId: string
  }) => {
    const result = await testWebProviderConnection(input)
    if (result.ok) {
      showToast({ tone: 'success', message: '连接测试成功' })
      return
    }
    showToast({ tone: 'error', message: result.error })
  }

  const handleExportData = () => {
    downloadWebLiteExportBundle(createWebLiteExportBundle({
      sessions,
      notes,
      settings,
    }))
    showToast({ tone: 'success', message: '数据已导出' })
  }

  const handleImportData = async (file: File) => {
    try {
      const bundle = await parseWebLiteImportBundle(file)
      const merged = mergeWebLiteImportBundle({
        localSessions: sessions,
        localNotes: notes,
        localSettings: settings,
        incoming: bundle,
      })
      await chatSessionsRepoWeb.replaceAllSessions(merged.sessions)
      await notesRepoWeb.replaceAllNotes(merged.notes)
      await settingsRepoWeb.save(merged.settings ?? { ai: { providers: [], defaultProviderId: undefined }, sync: null })
      setSettings(await settingsRepoWeb.load())
      await Promise.all([refreshSessions(), refreshNotes()])
      navigateTo({ name: 'chat' })
      showToast({
        tone: 'success',
        message: `数据已合并导入：${merged.sessions.length} 个会话，${merged.notes.length} 篇随笔`,
      })
    } catch (importError) {
      showToast({
        tone: 'error',
        message: importError instanceof Error ? importError.message : '导入失败',
      })
    }
  }

  const handleExportSyncSnapshot = () => {
    const snapshot = createWebLiteSyncSnapshot({
      sessions,
      notes,
      aiSettings: settings?.ai ?? null,
      syncSettings: settings?.sync ?? null,
    })
    downloadWebLiteSyncSnapshot(snapshot)
    showToast({ tone: 'success', message: '同步快照已导出' })
  }

  const handlePushSync = async () => {
    try {
      if (!settings?.sync) {
        showToast({ tone: 'error', message: '请先保存同步配置' })
        return
      }
      const allSessions = await chatSessionsRepoWeb.listAllSessions()
      const allNotes = await notesRepoWeb.listAllNotes()
      const result = await pushWebLiteToWebDav({
        sync: settings.sync,
        sessions: allSessions,
        notes: allNotes,
        aiSettings: settings.ai,
      })
      await settingsRepoWeb.saveSyncSettings({ ...settings.sync, lastSyncedAt: result.syncedAt })
      setSettings(await settingsRepoWeb.load())
      showToast({ tone: 'success', message: `上传完成：${result.sessions} 个会话，${result.notes} 篇随笔` })
    } catch (syncError) {
      showToast({ tone: 'error', message: syncError instanceof Error ? syncError.message : '上传失败' })
    }
  }

  const handlePullSync = async () => {
    try {
      if (!settings?.sync) {
        showToast({ tone: 'error', message: '请先保存同步配置' })
        return
      }
      const { result, sessions: remoteSessions, notes: remoteNotes, aiSettings } = await pullWebLiteFromWebDav({
        sync: settings.sync,
        localAiSettings: settings.ai,
      })
      await chatSessionsRepoWeb.replaceAllSessions(remoteSessions)
      await notesRepoWeb.replaceAllNotes(remoteNotes)
      if (aiSettings) {
        await settingsRepoWeb.saveAiSettings(aiSettings)
      }
      await settingsRepoWeb.saveSyncSettings({ ...settings.sync, lastSyncedAt: result.syncedAt })
      setSettings(await settingsRepoWeb.load())
      await Promise.all([refreshSessions(), refreshNotes()])
      navigateTo({ name: 'chat' })
      showToast({ tone: 'success', message: `下载完成：${result.sessions} 个会话，${result.notes} 篇随笔` })
    } catch (syncError) {
      showToast({ tone: 'error', message: syncError instanceof Error ? syncError.message : '下载失败' })
    }
  }

  const handleRunSync = async () => {
    try {
      if (!settings?.sync) {
        showToast({ tone: 'error', message: '请先保存同步配置' })
        return
      }
      const allSessions = await chatSessionsRepoWeb.listAllSessions()
      const allNotes = await notesRepoWeb.listAllNotes()
      const { result, sessions: mergedSessions, notes: mergedNotes, aiSettings } = await syncWebLiteWithWebDav({
        sync: settings.sync,
        localSessions: allSessions,
        localNotes: allNotes,
        localAiSettings: settings.ai,
      })
      await chatSessionsRepoWeb.replaceAllSessions(mergedSessions)
      await notesRepoWeb.replaceAllNotes(mergedNotes)
      if (aiSettings) {
        await settingsRepoWeb.saveAiSettings(aiSettings)
      }
      await settingsRepoWeb.saveSyncSettings({ ...settings.sync, lastSyncedAt: result.syncedAt })
      setSettings(await settingsRepoWeb.load())
      await Promise.all([refreshSessions(), refreshNotes()])
      showToast({ tone: 'success', message: `同步完成：${result.sessions} 个会话，${result.notes} 篇随笔` })
    } catch (syncError) {
      showToast({ tone: 'error', message: syncError instanceof Error ? syncError.message : '同步失败' })
    }
  }

  const handleContinueChatFromNote = async (note: WebLiteNote) => {
    const sessionFromNote = createChatSessionFromNote(note)
    await saveSession(sessionFromNote)
    await refreshSessions()
    navigateTo({ name: 'chat', sessionId: sessionFromNote.id })
    showToast({ tone: 'success', message: '已从随笔创建会话' })
  }

  const handleImportNote = async (file: File) => {
    try {
      const imported = await readMarkdownFile(file)
      const now = Date.now()
      const note: WebLiteNote = {
        id: crypto.randomUUID(),
        title: imported.title,
        content: imported.content,
        createdAt: now,
        updatedAt: now,
      }
      await saveNote(note)
      await refreshNotes()
      navigateTo({ name: 'notes', noteId: note.id })
      showToast({ tone: 'success', message: 'Markdown 已导入随笔' })
    } catch (importError) {
      showToast({
        tone: 'error',
        message: importError instanceof Error ? importError.message : 'Markdown 导入失败',
      })
    }
  }

  const handleSaveChatToNote = async () => {
    if (!session) return
    const assistantMessage = getLatestAssistantMessage(session)
    if (!assistantMessage) return
    const nextNote = createNoteFromAssistantMessage({
      session,
      assistantMessage,
    })
    await saveNote(nextNote)
    await refreshNotes()
    setActiveNote(nextNote)
    navigateTo({ name: 'notes', noteId: nextNote.id })
    showToast({ tone: 'success', message: '已保存到随笔' })
  }

  const showChatDetail = route.name === 'chat'
  const showNotesDetail = route.name === 'notes'
  const showChatList = !compact || route.name !== 'chat' || !route.sessionId
  const showNotesList = !compact || route.name !== 'notes' || !route.noteId
  const showChatDetailPane = !compact || (route.name === 'chat' && !!route.sessionId)
  const showNotesDetailPane = !compact || (route.name === 'notes' && !!route.noteId)

  return (
    <div className="web-app-shell">
      <div className="web-app-content">
        {activeTab === 'chat' && (
          <div className="web-split">
            {showChatList ? (
              <ChatListPage
                sessions={sessions}
                activeSessionId={route.name === 'chat' ? route.sessionId : undefined}
                onCreate={handleCreateSession}
                onOpen={(id) => navigateTo({ name: 'chat', sessionId: id })}
                onDelete={async (id) => {
                  await deleteSession(id)
                  if (route.name === 'chat' && route.sessionId === id) {
                    navigateTo({ name: 'chat' })
                  }
                }}
              />
            ) : null}
            {showChatDetailPane ? (
              <ChatDetailPage
                session={showChatDetail ? session : null}
                loading={sessionsLoading || chatDetailLoading}
                sending={sending}
                error={error}
                onBack={compact && showChatDetail && route.sessionId ? () => navigateTo({ name: 'chat' }) : undefined}
                onSaveToNote={session && getLatestAssistantMessage(session) ? handleSaveChatToNote : undefined}
                onVoiceError={(message) => showToast({ tone: 'error', message })}
                onSend={async (value) => {
                  await send(value)
                  await refreshSessions()
                }}
              />
            ) : null}
          </div>
        )}

        {activeTab === 'notes' && (
          <div className="web-split">
            {showNotesList ? (
              <NotesListPage
                notes={notes}
                activeNoteId={route.name === 'notes' ? route.noteId : undefined}
                onCreate={handleCreateNote}
                onImport={handleImportNote}
                onOpen={(id) => navigateTo({ name: 'notes', noteId: id })}
                onDelete={async (id) => {
                  await deleteNote(id)
                  if (route.name === 'notes' && route.noteId === id) {
                    navigateTo({ name: 'notes' })
                  }
                }}
              />
            ) : null}
            {showNotesDetailPane ? (
              <NoteDetailPage
                note={showNotesDetail ? activeNote : null}
                loading={notesLoading}
                onBack={compact && showNotesDetail && route.noteId ? () => navigateTo({ name: 'notes' }) : undefined}
                onContinueChat={handleContinueChatFromNote}
                onExportMarkdown={downloadNoteMarkdown}
                onSave={async (note) => {
                  await saveNote(note)
                  if (route.name === 'notes' && route.noteId === note.id) {
                    setActiveNote(note)
                  }
                  await refreshNotes()
                }}
              />
            ) : null}
          </div>
        )}

        {activeTab === 'settings' && (
          <SettingsPage
            settings={settings}
            onSaveAiSettings={handleSaveAiSettings}
            onSaveSyncSettings={handleSaveSyncSettings}
            onTestConnection={handleTestConnection}
            onExportData={handleExportData}
            onImportData={handleImportData}
            onExportSyncSnapshot={handleExportSyncSnapshot}
            onPushSync={handlePushSync}
            onPullSync={handlePullSync}
            onRunSync={handleRunSync}
          />
        )}
      </div>

      <BottomNav
        active={activeTab}
        onChange={(tab) => {
          if (tab === 'chat') navigateTo({ name: 'chat' })
          else if (tab === 'notes') navigateTo({ name: 'notes' })
          else navigateTo({ name: 'settings' })
        }}
      />
      <WebToast toast={toast} />
    </div>
  )
}
