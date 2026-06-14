import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createCommandRegistry, type CommandContext } from './registry'
import { docConversationService } from '../ai/application/docConversationService'

// jsdom 环境下，可能没有全局 alert，这里兜底一个
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
    editorZoom: 1,
    setEditorZoom: vi.fn(),
    isPdfActive: false,
    onPdfZoomIn: vi.fn().mockReturnValue(150),
    onPdfZoomOut: vi.fn().mockReturnValue(100),
    onPdfZoomReset: vi.fn().mockReturnValue(100),
    onPdfSelectTool: vi.fn(),
    onPdfActivateMarkupTool: vi.fn(),
    onPdfActivateShapeTool: vi.fn(),
    onPdfActivateStampTool: vi.fn(),
    onPdfActivateFreeTextTool: vi.fn(),
    onPdfAddNote: vi.fn(),
    onPdfAddDetachedNote: vi.fn(),
    onPdfDeleteSelected: vi.fn(),
    onPdfSelectColorIndex: vi.fn(),
    editMode: 'source',
    setEditMode: vi.fn(),

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
    openCalendarDialog: vi.fn(),
    openReminderToolDialog: vi.fn(),
  }

  return ctx
}

describe('command registry - layout & view', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
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

  it('zoom commands should control PDF when current tab is a PDF', () => {
    const ctx = createMockCtx()
    ctx.isPdfActive = true
    const registry = createCommandRegistry(ctx)

    registry.zoom_in()
    registry.zoom_out()
    registry.zoom_reset()

    expect(ctx.onPdfZoomIn).toHaveBeenCalledTimes(1)
    expect(ctx.onPdfZoomOut).toHaveBeenCalledTimes(1)
    expect(ctx.onPdfZoomReset).toHaveBeenCalledTimes(1)
    expect(ctx.setEditorZoom).not.toHaveBeenCalled()
    expect(ctx.setStatusMessage).toHaveBeenCalledWith('PDF Zoom：150%')
    expect(ctx.setStatusMessage).toHaveBeenCalledWith('PDF Zoom：100%')
  })

  it('zoom commands should keep using editor zoom when current tab is not a PDF', () => {
    const ctx = createMockCtx()
    const registry = createCommandRegistry(ctx)

    registry.zoom_in()
    registry.zoom_out()
    registry.zoom_reset()

    expect(ctx.onPdfZoomIn).not.toHaveBeenCalled()
    expect(ctx.onPdfZoomOut).not.toHaveBeenCalled()
    expect(ctx.onPdfZoomReset).not.toHaveBeenCalled()
    expect(ctx.setEditorZoom).toHaveBeenCalledTimes(3)
  })

  it('pdf annotation commands should dispatch through PDF callbacks only when current tab is a PDF', () => {
    const ctx = createMockCtx()
    ctx.isPdfActive = true
    const registry = createCommandRegistry(ctx)

    registry.pdf_tool_highlight()
    registry.pdf_tool_arrow()
    registry.pdf_tool_stamp()
    registry.pdf_tool_free_text()
    registry.pdf_add_note()
    registry.pdf_add_detached_note()
    registry.pdf_color_3()
    registry.pdf_delete_selected()

    expect(ctx.onPdfActivateMarkupTool).toHaveBeenCalledWith('highlight')
    expect(ctx.onPdfActivateShapeTool).toHaveBeenCalledWith('arrow')
    expect(ctx.onPdfActivateStampTool).toHaveBeenCalledTimes(1)
    expect(ctx.onPdfActivateFreeTextTool).toHaveBeenCalledTimes(1)
    expect(ctx.onPdfAddNote).toHaveBeenCalledTimes(1)
    expect(ctx.onPdfAddDetachedNote).toHaveBeenCalledTimes(1)
    expect(ctx.onPdfSelectColorIndex).toHaveBeenCalledWith(2)
    expect(ctx.onPdfDeleteSelected).toHaveBeenCalledTimes(1)
  })

  it('tools commands should open calendar and repeat reminder tools', () => {
    const ctx = createMockCtx()
    const registry = createCommandRegistry(ctx)

    registry.tools_calendar()
    registry.tools_repeat_reminders()

    expect(ctx.openCalendarDialog).toHaveBeenCalledTimes(1)
    expect(ctx.openReminderToolDialog).toHaveBeenCalledTimes(1)
  })
})

describe('command registry - file commands', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
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
    // updateActiveMeta 不应被调用：createTab 已设置 path/title，
    // 且 updateActiveMeta 闭包中的 activeId 指向旧标签会导致两个重复标签
    expect(ctx.updateActiveMeta).not.toHaveBeenCalled()
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

    expect(ctx.openFolderInSidebar).toHaveBeenCalledTimes(1)

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

  it('export_html should call hooks or show fallback message', async () => {
    const ctx = createMockCtx()
    const registry = createCommandRegistry(ctx)

    await registry.export_html()
    expect(ctx.exportHtml).toHaveBeenCalled()

    ctx.exportHtml = undefined
    await registry.export_html()
    expect(ctx.setStatusMessage).toHaveBeenCalledWith('当前版本 HTML 导出功能未挂载')
  })
})

describe('command registry - lifecycle & clipboard', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
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

  it('toggle_sidebar should delegate to ctx.toggleSidebarVisible', () => {
    const ctx = createMockCtx()
    const registry = createCommandRegistry(ctx)

    registry.toggle_sidebar()

    expect(ctx.toggleSidebarVisible).toHaveBeenCalled()
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

describe('command registry - tools', () => {
  it('tools_calendar should open calendar dialog', () => {
    const ctx = createMockCtx()
    const registry = createCommandRegistry(ctx)

    registry.tools_calendar()

    expect(ctx.openCalendarDialog).toHaveBeenCalled()
  })
})

describe('command registry - help commands', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
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
    vi.restoreAllMocks()
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
    expect(ctx.openAiChatDialog).toHaveBeenCalled()
  })

  it('ai_chat should handle missing aiClient', async () => {
    const ctx = createMockCtx()
    ctx.aiClient = undefined
    const registry = createCommandRegistry(ctx)

    await registry.ai_chat()
    expect(ctx.setStatusMessage).toHaveBeenCalledWith('AI Chat 未配置：AI 客户端未初始化')
  })

  it('ai_ask_selection should do nothing when no selection text', async () => {
    const ctx = createMockCtx()
    ctx.getCurrentSelectionText = vi.fn().mockReturnValue('  ')
    const registry = createCommandRegistry(ctx)

    await registry.ai_ask_selection()
    expect(ctx.openAiChatDialog).not.toHaveBeenCalled()
    expect(ctx.setStatusMessage).not.toHaveBeenCalled()
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

  it('ai_conversation_compress should reflect live compression status updates', async () => {
    const ctx = createMockCtx()
    const compressSpy = vi.spyOn(docConversationService, 'compressByDocPath').mockImplementation(async (_docPath, options) => {
      options?.onStatus?.({
        type: 'compression-status',
        docPath: '/dir',
        phase: 'preparing',
        elapsedMs: 1_000,
      })
      options?.onStatus?.({
        type: 'compression-status',
        docPath: '/dir',
        phase: 'summarizing-batch',
        elapsedMs: 5_000,
        currentBatch: 2,
        totalBatches: 3,
      })
      options?.onStatus?.({
        type: 'compression-status',
        docPath: '/dir',
        phase: 'saving',
        elapsedMs: 8_000,
      })
      options?.onStatus?.({
        type: 'compression-status',
        docPath: '/dir',
        phase: 'completed',
        elapsedMs: 9_000,
      })
    })
    const registry = createCommandRegistry(ctx)

    await registry.ai_conversation_compress()

    expect(compressSpy).toHaveBeenCalledWith('/dir', expect.objectContaining({ onStatus: expect.any(Function) }))
    expect(ctx.setStatusMessage).toHaveBeenCalledWith('正在准备压缩会话历史…（1s）')
    expect(ctx.setStatusMessage).toHaveBeenCalledWith('正在压缩第 2/3 批会话历史…（5s）')
    expect(ctx.setStatusMessage).toHaveBeenCalledWith('正在保存压缩结果…（8s）')
    expect(ctx.setStatusMessage).toHaveBeenCalledWith('会话压缩完成 ✓')
  })

  it('ai_conversation_compress should show timeout and already-running states', async () => {
    const ctx = createMockCtx()
    vi.spyOn(docConversationService, 'compressByDocPath').mockImplementation(async (_docPath, options) => {
      options?.onStatus?.({
        type: 'compression-status',
        docPath: '/dir',
        phase: 'already-running',
        elapsedMs: 31_000,
      })
      options?.onStatus?.({
        type: 'compression-status',
        docPath: '/dir',
        phase: 'timeout',
        elapsedMs: 46_000,
      })
    })
    const registry = createCommandRegistry(ctx)

    await registry.ai_conversation_compress()

    expect(ctx.setStatusMessage).toHaveBeenCalledWith('当前文档的会话压缩已在后台运行…（31s）')
    expect(ctx.setStatusMessage).toHaveBeenCalledWith('会话压缩超时，已停止。请检查模型连接后重试。（46s）')
  })
})
