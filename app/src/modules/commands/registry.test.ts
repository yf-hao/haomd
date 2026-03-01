import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createCommandRegistry, type CommandContext } from './registry'

// jsdom 环境下，可能没有全局 alert，这里兜底一个，避免 export_pdf 报错
;(globalThis as any).alert = (globalThis as any).alert ?? vi.fn()

function createMockCtx(): CommandContext & {
  setStatusMessage: ReturnType<typeof vi.fn>
} {
  const setStatusMessage = vi.fn()

  const ctx: any = {
    // LayoutCommandContext
    layout: 'preview-left',
    setLayout: vi.fn(),
    setShowPreview: vi.fn(),
    setStatusMessage,
    aiChatMode: 'docked',
    setAiChatMode: vi.fn(),
    aiChatDockSide: 'right',
    setAiChatDockSide: vi.fn(),
    aiChatOpen: false,

    // FileCommandContext
    confirmLoseChanges: () => true,
    hasUnsavedChanges: () => false,
    newDocument: vi.fn(),
    setFilePath: vi.fn(),
    applyOpenedContent: vi.fn(),
    openFile: vi.fn().mockResolvedValue({ ok: true, data: { path: '/doc.md', content: 'hello' } }),
    save: vi.fn().mockResolvedValue({ ok: true }),
    saveAs: vi.fn().mockResolvedValue({ ok: true }),
    handleShowRecent: undefined,
    clearRecentAll: vi.fn().mockResolvedValue({ ok: true }),
    createTab: vi.fn(),
    updateActiveMeta: vi.fn(),
    openFolderInSidebar: undefined,
    addStandaloneFile: vi.fn(),
    refreshPdfRecent: vi.fn(),
    exportHtml: vi.fn().mockResolvedValue(undefined),
    exportPdf: vi.fn().mockResolvedValue(undefined),

    // AppLifecycleCommandContext
    toggleSidebarVisible: vi.fn(),
    closeCurrentTab: vi.fn(),
    onRequestCloseCurrentTab: vi.fn(),
    onRequestQuit: vi.fn(),

    // AiCommandContext
    aiClient: {
      openChat: vi.fn().mockResolvedValue({ ok: true, message: 'chat ok' }),
      askAboutFile: vi.fn().mockResolvedValue({ ok: true, message: 'file ok' }),
      askAboutSelection: vi.fn().mockResolvedValue({ ok: true, message: 'sel ok' }),
    },
    openAiChatDialog: vi.fn(),
    openGlobalMemoryDialog: vi.fn(),
    getCurrentMarkdown: vi.fn().mockReturnValue('# doc'),
    getCurrentFileName: vi.fn().mockReturnValue('doc.md'),
    getCurrentSelectionText: vi.fn().mockReturnValue('selected'),
    getCurrentFilePath: vi.fn().mockReturnValue('/dir/doc.md'),
    openDocConversationsHistory: vi.fn(),
  }

  return ctx
}

describe('command registry - layout & view', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('layout commands should update layout and preview state', () => {
    const ctx = createMockCtx()
    const registry = createCommandRegistry(ctx)

    registry.layout_editor_only()
    expect(ctx.setLayout).toHaveBeenCalledWith('editor-only')
    expect(ctx.setShowPreview).toHaveBeenCalledWith(false)

    registry.layout_preview_left()
    expect(ctx.setLayout).toHaveBeenCalledWith('preview-left')
    expect(ctx.setShowPreview).toHaveBeenCalledWith(true)

    registry.layout_preview_right()
    expect(ctx.setLayout).toHaveBeenCalledWith('preview-right')

    registry.layout_preview_only()
    expect(ctx.setLayout).toHaveBeenCalledWith('preview-only')
  })

  it('toggle_preview_only should remember last layout and restore it', () => {
    const ctx = createMockCtx()
    const registry = createCommandRegistry(ctx)

    ctx.layout = 'preview-right'
    registry.toggle_preview_only()
    expect(ctx.setLayout).toHaveBeenCalledWith('preview-only')

    ;(ctx.setLayout as any).mockClear()
    ctx.layout = 'preview-only'
    registry.toggle_preview_only()
    expect(ctx.setLayout).toHaveBeenCalledWith('preview-right')
  })

  it('ai chat dock / floating commands should update ai chat view state', () => {
    const ctx = createMockCtx()
    const registry = createCommandRegistry(ctx)

    registry.view_ai_chat_floating()
    expect(ctx.setAiChatMode).toHaveBeenCalledWith('floating')

    registry.view_ai_chat_dock_left()
    expect(ctx.setAiChatMode).toHaveBeenCalledWith('docked')
    expect(ctx.setAiChatDockSide).toHaveBeenCalledWith('left')

    registry.view_ai_chat_dock_right()
    expect(ctx.setAiChatDockSide).toHaveBeenCalledWith('right')
  })
})

describe('command registry - file commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('new_file should create a new tab and document', () => {
    const ctx = createMockCtx()
    const registry = createCommandRegistry(ctx)

    registry.new_file()
    expect(ctx.createTab).toHaveBeenCalled()
    expect(ctx.newDocument).toHaveBeenCalled()
  })

  it('save / save_as should delegate to ctx', async () => {
    const ctx = createMockCtx()
    const registry = createCommandRegistry(ctx)

    await registry.save()
    await registry.save_as()

    expect(ctx.save).toHaveBeenCalled()
    expect(ctx.saveAs).toHaveBeenCalled()
  })

  it('open_file should open text file into a new tab', async () => {
    const ctx = createMockCtx()
    ;(ctx.openFile as any).mockResolvedValueOnce({
      ok: true,
      data: { path: '/doc.md', content: 'hello world' },
    })

    const registry = createCommandRegistry(ctx)
    await registry.open_file()

    expect(ctx.createTab).toHaveBeenCalledWith({ path: '/doc.md', content: 'hello world' })
    expect(ctx.applyOpenedContent).toHaveBeenCalledWith('hello world')
    expect(ctx.setFilePath).toHaveBeenCalledWith('/doc.md')
    expect(ctx.updateActiveMeta).toHaveBeenCalledWith('/doc.md', false)
  })

  it('open_file should handle pdf specially and refresh recent pdf list', async () => {
    const ctx = createMockCtx()
    ;(ctx.openFile as any).mockResolvedValueOnce({
      ok: true,
      data: { path: '/foo.PDF', content: '' },
    })

    const registry = createCommandRegistry(ctx)
    await registry.open_file()

    expect(ctx.createTab).toHaveBeenCalledWith({ path: '/foo.PDF', content: '' })
    expect(ctx.refreshPdfRecent).toHaveBeenCalled()
  })

  it('open_folder should respect unsaved changes and absence of sidebar handler', async () => {
    const ctx = createMockCtx()
    ctx.hasUnsavedChanges = () => true
    ctx.confirmLoseChanges = () => false
    ctx.openFolderInSidebar = vi.fn()

    const registry = createCommandRegistry(ctx)
    await registry.open_folder()

    expect(ctx.openFolderInSidebar).not.toHaveBeenCalled()

    ctx.hasUnsavedChanges = () => false
    ctx.openFolderInSidebar = undefined
    await registry.open_folder()
    expect(ctx.setStatusMessage).toHaveBeenCalledWith('当前版本暂不支持 Sidebar 打开文件夹')
  })

  it('open_recent should fall back when handler missing', async () => {
    const ctx = createMockCtx()
    ctx.handleShowRecent = undefined
    const registry = createCommandRegistry(ctx)

    await registry.open_recent()
    expect(ctx.setStatusMessage).toHaveBeenCalledWith('最近文件面板已移除，请使用菜单 File → Open Recent')
  })

  it('clear_recent should show success message when clearRecentAll ok', async () => {
    const ctx = createMockCtx()
    const registry = createCommandRegistry(ctx)

    await registry.clear_recent()
    expect(ctx.setStatusMessage).toHaveBeenCalledWith('已清空最近文件')
  })

  it('export_html / export_pdf should call hooks or show fallback message', async () => {
    const ctx = createMockCtx()
    const registry = createCommandRegistry(ctx)

    await registry.export_html()
    expect(ctx.exportHtml).toHaveBeenCalled()

    ctx.exportHtml = undefined
    await registry.export_html()
    expect(ctx.setStatusMessage).toHaveBeenCalledWith('当前版本 HTML 导出功能未挂载')

    await registry.export_pdf()
    expect(ctx.exportPdf).toHaveBeenCalled()

    ctx.exportPdf = undefined
    await registry.export_pdf()
    expect(ctx.setStatusMessage).toHaveBeenCalledWith('当前版本 PDF 导出功能未挂载')
  })
})

describe('command registry - lifecycle & clipboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('close_file should prefer onRequestCloseCurrentTab and fallback to closeCurrentTab', () => {
    const ctx = createMockCtx()
    const registry = createCommandRegistry(ctx)

    registry.close_file()
    expect(ctx.onRequestCloseCurrentTab).toHaveBeenCalled()

    ctx.onRequestCloseCurrentTab = undefined as any
    registry.close_file()
    expect(ctx.closeCurrentTab).toHaveBeenCalled()
  })

  it('quit should prefer onRequestQuit and fallback to confirmLoseChanges', () => {
    const ctx = createMockCtx()
    const registry = createCommandRegistry(ctx)

    registry.quit()
    expect(ctx.onRequestQuit).toHaveBeenCalled()

    ctx.onRequestQuit = undefined as any
    const confirmSpy = vi.fn().mockReturnValue(true)
    ctx.confirmLoseChanges = confirmSpy

    registry.quit()
    expect(confirmSpy).toHaveBeenCalled()
    expect(ctx.setStatusMessage).toHaveBeenCalledWith('占位：Quit 未实现')
  })

  it('copy / cut should fallback when execCommand fails', () => {
    const ctx = createMockCtx()
    const registry = createCommandRegistry(ctx)

    const originalDocument = (globalThis as any).document
    ;(globalThis as any).document = {
      execCommand: vi.fn().mockReturnValue(false),
    }

    registry.copy()
    registry.cut()

    expect(ctx.setStatusMessage).toHaveBeenCalledWith('复制未生效')
    expect(ctx.setStatusMessage).toHaveBeenCalledWith('剪切未生效')

    ;(globalThis as any).document = originalDocument
  })
})

describe('command registry - help commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('help_docs should open usage docs into a new document', () => {
    const ctx = createMockCtx()
    const registry = createCommandRegistry(ctx)

    const confirmSpy = vi.fn().mockReturnValue(true)
    ctx.confirmLoseChanges = confirmSpy

    registry.help_docs()

    expect(confirmSpy).toHaveBeenCalled()
    expect(ctx.newDocument).toHaveBeenCalled()
    expect(ctx.applyOpenedContent).toHaveBeenCalledWith(expect.any(String))
    expect(ctx.setFilePath).toHaveBeenCalledWith('使用说明.md')
    expect(ctx.setStatusMessage).toHaveBeenCalledWith('已打开使用说明')
  })

  it('other help commands should set status message', () => {
    const ctx = createMockCtx()
    const registry = createCommandRegistry(ctx)

    registry.haomd_about()
    registry.help_release()
    registry.help_issue()
    registry.help_about()

    expect(ctx.setStatusMessage).toHaveBeenCalledWith('HaoMD · 关于（占位）')
    expect(ctx.setStatusMessage).toHaveBeenCalledWith('HaoMD · 菜单占位/帮助')
  })
})

describe('command registry - ai commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ai_chat / ai_ask_file / ai_ask_selection happy path', async () => {
    const ctx = createMockCtx()
    const registry = createCommandRegistry(ctx)

    await registry.ai_chat()
    await registry.ai_ask_file()
    await registry.ai_ask_selection()

    expect(ctx.setStatusMessage).toHaveBeenCalledWith('chat ok')
    expect(ctx.setStatusMessage).toHaveBeenCalledWith('file ok')
    expect(ctx.setStatusMessage).toHaveBeenCalledWith('sel ok')
    expect(ctx.openAiChatDialog).toHaveBeenCalled()
  })

  it('ai_chat should handle missing aiClient', async () => {
    const ctx = createMockCtx()
    ctx.aiClient = undefined
    const registry = createCommandRegistry(ctx)

    await registry.ai_chat()
    expect(ctx.setStatusMessage).toHaveBeenCalledWith('AI Chat 未配置：AI 客户端未初始化')
  })

  it('ai_ask_selection should show message when no selection text', async () => {
    const ctx = createMockCtx()
    ctx.getCurrentSelectionText = vi.fn().mockReturnValue('  ')
    const registry = createCommandRegistry(ctx)

    await registry.ai_ask_selection()
    expect(ctx.setStatusMessage).toHaveBeenCalledWith('当前没有选中的文本')
  })

  it('ai_session_globalMemory commands should call openGlobalMemoryDialog or show fallback', () => {
    const ctx = createMockCtx()
    const registry = createCommandRegistry(ctx)

    // 正常情况
    registry.ai_session_globalMemory_userPersona()
    registry.ai_session_globalMemory_manage()
    expect(ctx.openGlobalMemoryDialog).toHaveBeenCalledWith({ initialTab: 'persona' })
    expect(ctx.openGlobalMemoryDialog).toHaveBeenCalledWith({ initialTab: 'manage' })

    // 缺少 openGlobalMemoryDialog
    ctx.openGlobalMemoryDialog = undefined as any
    registry.ai_session_globalMemory_userPersona()
    registry.ai_session_globalMemory_manage()
    expect(ctx.setStatusMessage).toHaveBeenCalledWith('当前版本未注册 Global Memory 对话框')
  })
})
