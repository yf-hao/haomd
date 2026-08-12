import { useCallback, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { EditorView } from '@codemirror/view'

type EditorMode = 'source' | 'wysiwyg'

type DocumentUpdateOptions = {
  markDirty?: boolean
}

export type UseEditorDocumentSyncOptions = {
  activeIdRef: RefObject<string | null>
  activeTabId: string | null
  activeTabContent?: string
  activeTabDirty?: boolean
  editorViewRef: RefObject<EditorView | null>
  sourceEditorTabIdRef: RefObject<string | null>
  sourceEditorRevisionRef: RefObject<number>
  editModeRef: RefObject<EditorMode>
  isPdfActiveRef: RefObject<boolean>
  isPreviewVisible: boolean
  skipNextPreviewThrottleRef: RefObject<boolean>
  markdownRef: RefObject<string>
  editorMarkdownRef: RefObject<string>
  setMarkdown: Dispatch<SetStateAction<string>>
  setEditorMarkdown: Dispatch<SetStateAction<string>>
  updateActiveContent: (content: string, options?: DocumentUpdateOptions) => void
  markActiveTabDirty: () => void
  markDirty: () => void
  applyChunkEdit: (value: string) => string | null
  schedulePreviewDocument: (tabId: string, view: EditorView, revision: number) => void
}

type SourceDocumentSnapshot = {
  tabId: string
  view: EditorView
  revision: number
}

export function useEditorDocumentSync({
  activeIdRef,
  activeTabId,
  activeTabContent,
  activeTabDirty,
  editorViewRef,
  sourceEditorTabIdRef,
  sourceEditorRevisionRef,
  editModeRef,
  isPdfActiveRef,
  isPreviewVisible,
  skipNextPreviewThrottleRef,
  markdownRef,
  editorMarkdownRef,
  setMarkdown,
  setEditorMarkdown,
  updateActiveContent,
  markActiveTabDirty,
  markDirty,
  applyChunkEdit,
  schedulePreviewDocument,
}: UseEditorDocumentSyncOptions) {
  const sourceDocumentSyncTimerRef = useRef<number | null>(null)
  const sourceDocumentSyncSnapshotRef = useRef<SourceDocumentSnapshot | null>(null)
  const sourceDirtyTabRef = useRef<string | null>(null)

  const clearSourceDocumentSync = useCallback(() => {
    if (sourceDocumentSyncTimerRef.current != null) {
      window.clearTimeout(sourceDocumentSyncTimerRef.current)
      sourceDocumentSyncTimerRef.current = null
    }
    sourceEditorRevisionRef.current += 1
    sourceDocumentSyncSnapshotRef.current = null
  }, [sourceEditorRevisionRef])

  const commitSourceDocumentSnapshot = useCallback((tabId: string, content: string, shouldMarkDirty: boolean) => {
    if (activeIdRef.current !== tabId) return

    markdownRef.current = content
    editorMarkdownRef.current = content
    if (isPreviewVisible) {
      skipNextPreviewThrottleRef.current = true
    }
    setMarkdown(content)
    setEditorMarkdown(content)
    updateActiveContent(content, { markDirty: shouldMarkDirty })
    sourceDocumentSyncSnapshotRef.current = null
  }, [
    activeIdRef,
    editorMarkdownRef,
    markdownRef,
    setEditorMarkdown,
    setMarkdown,
    isPreviewVisible,
    skipNextPreviewThrottleRef,
    updateActiveContent,
  ])

  const scheduleSourceDocumentSync = useCallback((tabId: string, view: EditorView, revision: number) => {
    sourceDocumentSyncSnapshotRef.current = { tabId, view, revision }
    if (sourceDocumentSyncTimerRef.current != null) {
      window.clearTimeout(sourceDocumentSyncTimerRef.current)
    }

    sourceDocumentSyncTimerRef.current = window.setTimeout(() => {
      sourceDocumentSyncTimerRef.current = null
      const snapshot = sourceDocumentSyncSnapshotRef.current
      if (
        !snapshot ||
        snapshot.tabId !== tabId ||
        snapshot.revision !== revision ||
        activeIdRef.current !== tabId ||
        editorViewRef.current !== view
      ) {
        return
      }

      const rawContent = view.state.doc.toString()
      const content = applyChunkEdit(rawContent) ?? rawContent
      commitSourceDocumentSnapshot(snapshot.tabId, content, true)
    }, 150)
  }, [activeIdRef, applyChunkEdit, commitSourceDocumentSnapshot, editorViewRef])

  const flushSourceDocumentSync = useCallback((tabId = activeIdRef.current) => {
    if (!tabId) return null

    const currentView =
      editModeRef.current === 'source' &&
      !isPdfActiveRef.current &&
      sourceEditorTabIdRef.current === tabId &&
      editorViewRef.current?.dom.isConnected
        ? editorViewRef.current
        : null
    const pendingSnapshot = sourceDocumentSyncSnapshotRef.current
    const view = currentView ?? (pendingSnapshot?.tabId === tabId ? pendingSnapshot.view : null)
    const rawContent = view?.state.doc.toString() ?? markdownRef.current
    const content = view ? applyChunkEdit(rawContent) ?? rawContent : rawContent
    const shouldMarkDirty = activeTabId === tabId && activeTabContent !== content

    clearSourceDocumentSync()
    if (view && isPreviewVisible) {
      schedulePreviewDocument(tabId, view, sourceEditorRevisionRef.current)
    }
    commitSourceDocumentSnapshot(tabId, content, shouldMarkDirty)
    return content
  }, [
    activeIdRef,
    activeTabContent,
    activeTabId,
    applyChunkEdit,
    clearSourceDocumentSync,
    commitSourceDocumentSnapshot,
    editModeRef,
    editorViewRef,
    isPdfActiveRef,
    markdownRef,
    isPreviewVisible,
    schedulePreviewDocument,
    sourceEditorTabIdRef,
    sourceEditorRevisionRef,
  ])

  const handleSourceDocumentChange = useCallback((view: EditorView) => {
    const tabId = activeIdRef.current
    if (!tabId || view !== editorViewRef.current) return

    const revision = sourceEditorRevisionRef.current + 1
    sourceEditorRevisionRef.current = revision
    sourceDocumentSyncSnapshotRef.current = { tabId, view, revision }

    if (!activeTabDirty && sourceDirtyTabRef.current !== tabId) {
      markActiveTabDirty()
      sourceDirtyTabRef.current = tabId
      markDirty()
    }

    schedulePreviewDocument(tabId, view, revision)
    scheduleSourceDocumentSync(tabId, view, revision)
  }, [
    activeIdRef,
    activeTabDirty,
    editorViewRef,
    markActiveTabDirty,
    markDirty,
    schedulePreviewDocument,
    scheduleSourceDocumentSync,
    sourceEditorRevisionRef,
  ])

  const resetDirtyTracking = useCallback(() => {
    sourceDirtyTabRef.current = null
  }, [])

  const hasPendingSourceEdits = useCallback((tabId: string | null) => (
    tabId !== null && sourceDocumentSyncSnapshotRef.current?.tabId === tabId
  ), [])

  return {
    clearSourceDocumentSync,
    flushSourceDocumentSync,
    handleSourceDocumentChange,
    hasPendingSourceEdits,
    resetDirtyTracking,
  }
}
