import { describe, it, expect, vi } from 'vitest'
import { createCommandRegistry, type CommandContext } from './registry'

function createMockCtx(): CommandContext {
  return {
    layout: 'preview-left',
    setLayout: vi.fn(),
    setShowPreview: vi.fn(),
    setStatusMessage: vi.fn(),
    confirmLoseChanges: () => true,
    hasUnsavedChanges: () => false,
    newDocument: vi.fn(),
    setFilePath: vi.fn(),
    applyOpenedContent: vi.fn(),
    openFile: vi.fn(),
    save: vi.fn(),
    saveAs: vi.fn(),
    handleShowRecent: undefined,
    clearRecentAll: vi.fn(),
    createTab: vi.fn(),
    updateActiveMeta: vi.fn(),
    openFolderInSidebar: undefined,
    toggleSidebarVisible: undefined,
    closeCurrentTab: vi.fn(),
    onRequestCloseCurrentTab: vi.fn(),
    onRequestQuit: vi.fn(),
    aiClient: {
      openChat: vi.fn().mockResolvedValue({ ok: true, message: 'chat ok' }),
      askAboutFile: vi.fn().mockResolvedValue({ ok: true, message: 'file ok' }),
      askAboutSelection: vi.fn().mockResolvedValue({ ok: true, message: 'sel ok' }),
    },
  }
}

describe('command registry', () => {
  it('layout commands should update layout and preview state', () => {
    const ctx = createMockCtx()
    const registry = createCommandRegistry(ctx)

    registry.layout_editor_only()
    expect(ctx.setLayout).toHaveBeenCalledWith('editor-only')
    expect(ctx.setShowPreview).toHaveBeenCalledWith(false)

    registry.toggle_preview()
    expect(ctx.setShowPreview).toHaveBeenCalled()
  })

  it('ai commands should use IAiClient and set status message', async () => {
    const ctx = createMockCtx()
    const registry = createCommandRegistry(ctx)

    await registry.ai_chat()
    await registry.ai_ask_file()
    await registry.ai_ask_selection()

    expect(ctx.setStatusMessage).toHaveBeenCalledWith('chat ok')
    expect(ctx.setStatusMessage).toHaveBeenCalledWith('file ok')
    expect(ctx.setStatusMessage).toHaveBeenCalledWith('sel ok')
  })
})
