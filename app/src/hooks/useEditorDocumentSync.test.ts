import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { useEditorDocumentSync } from './useEditorDocumentSync'

function createEditorView(content: { value: string }): EditorView {
  return {
    dom: { isConnected: true },
    state: {
      doc: {
        toString: () => content.value,
      },
    },
  } as unknown as EditorView
}

describe('useEditorDocumentSync', () => {
  it('reads the latest editor document only when preview or document sync runs', () => {
    vi.useFakeTimers()
    try {
      const content = { value: 'initial' }
      const view = createEditorView(content)
      const activeIdRef = { current: 'doc-1' }
      const editorViewRef = { current: view }
      const sourceEditorTabIdRef = { current: 'doc-1' }
      const sourceEditorRevisionRef = { current: 0 }
      const editModeRef = { current: 'source' as const }
      const isPdfActiveRef = { current: false }
      const markdownRef = { current: 'initial' }
      const editorMarkdownRef = { current: 'initial' }
      const updateActiveContent = vi.fn()
      const schedulePreviewDocument = vi.fn()

      const { result } = renderHook(() => useEditorDocumentSync({
        activeIdRef,
        activeTabId: 'doc-1',
        activeTabContent: 'initial',
        activeTabDirty: false,
        editorViewRef,
        sourceEditorTabIdRef,
        sourceEditorRevisionRef,
        editModeRef,
        isPdfActiveRef,
        isPreviewVisible: true,
        skipNextPreviewThrottleRef: { current: false },
        markdownRef,
        editorMarkdownRef,
        setMarkdown: vi.fn(),
        setEditorMarkdown: vi.fn(),
        updateActiveContent,
        markActiveTabDirty: vi.fn(),
        markDirty: vi.fn(),
        applyChunkEdit: () => null,
        schedulePreviewDocument,
      }))

      act(() => {
        content.value = 'updated'
        result.current.handleSourceDocumentChange(view)
      })

      expect(updateActiveContent).not.toHaveBeenCalled()
      expect(schedulePreviewDocument).toHaveBeenCalledWith('doc-1', view, 1)

      act(() => {
        vi.advanceTimersByTime(149)
      })
      expect(updateActiveContent).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(updateActiveContent).toHaveBeenCalledWith('updated', { markDirty: true })
      expect(markdownRef.current).toBe('updated')
      expect(editorMarkdownRef.current).toBe('updated')
    } finally {
      vi.useRealTimers()
    }
  })

  it('flushes the latest editor document before a boundary operation', () => {
    const content = { value: 'before' }
    const view = createEditorView(content)
    const updateActiveContent = vi.fn()
    const activeIdRef = { current: 'doc-1' }

    const { result } = renderHook(() => useEditorDocumentSync({
      activeIdRef,
      activeTabId: 'doc-1',
      activeTabContent: 'before',
      activeTabDirty: false,
      editorViewRef: { current: view },
      sourceEditorTabIdRef: { current: 'doc-1' },
      sourceEditorRevisionRef: { current: 0 },
      editModeRef: { current: 'source' as const },
      isPdfActiveRef: { current: false },
      isPreviewVisible: true,
      skipNextPreviewThrottleRef: { current: false },
      markdownRef: { current: 'before' },
      editorMarkdownRef: { current: 'before' },
      setMarkdown: vi.fn(),
      setEditorMarkdown: vi.fn(),
      updateActiveContent,
      markActiveTabDirty: vi.fn(),
      markDirty: vi.fn(),
      applyChunkEdit: () => null,
      schedulePreviewDocument: vi.fn(),
    }))

    act(() => {
      content.value = 'latest'
    })

    expect(result.current.flushSourceDocumentSync()).toBe('latest')
    expect(updateActiveContent).toHaveBeenCalledWith('latest', { markDirty: true })
  })
})
