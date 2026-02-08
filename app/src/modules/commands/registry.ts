import usageDocs from '../../docs/使用说明.md?raw'
import type { IAiClient } from '../ai/client'
import type { ChatEntryMode, EntryContext } from '../ai/domain/chatSession'

export type AppCommand = () => void | Promise<void>

export type CommandRegistry = Record<string, AppCommand>

// ===== 命令上下文拆分（ISP） =====

type StatusContext = {
  setStatusMessage: (msg: string) => void
}

/**
 * 布局相关命令所需的上下文。
 */
export type LayoutCommandContext = StatusContext & {
  layout: string
  setLayout: (layout: string) => void
  setShowPreview: (value: boolean | ((prev: boolean) => boolean)) => void
}

/**
 * 文件/标签相关命令所需的上下文。
 */
export type FileCommandContext = StatusContext & {
  confirmLoseChanges: () => boolean
  /**
   * 是否存在需要用户确认的未保存变更
   */
  hasUnsavedChanges: () => boolean
  newDocument: () => void
  setFilePath: (path: string) => void
  applyOpenedContent: (content: string) => void
  openFile: () => Promise<any>
  save: () => Promise<any>
  saveAs: () => Promise<any>
  handleShowRecent?: () => Promise<void>
  clearRecentAll: () => Promise<any>
  createTab: () => void
  updateActiveMeta: (path: string, dirty: boolean) => void
  openFolderInSidebar?: () => Promise<void>
}

/**
 * 应用生命周期相关命令（关闭标签、退出应用）所需的上下文。
 */
export type AppLifecycleCommandContext = StatusContext & {
  confirmLoseChanges: () => boolean
  toggleSidebarVisible?: () => void
  closeCurrentTab: () => void
  onRequestCloseCurrentTab?: () => void
  onRequestQuit?: () => void
}

/**
 * 帮助/文档相关命令所需的上下文。
 */
export type HelpCommandContext = StatusContext & {
  confirmLoseChanges: () => boolean
  newDocument: () => void
  applyOpenedContent: (content: string) => void
  setFilePath: (path: string) => void
}

/**
 * AI 相关命令所需的上下文。
 */
export type AiCommandContext = StatusContext & {
  aiClient?: IAiClient
  /**
   * 打开 AI Chat 对话框的 UI 回调，由 WorkspaceShell 提供。
   */
  openAiChatDialog?: (options: { entryMode: ChatEntryMode; initialContext?: EntryContext }) => void
  /** 获取当前编辑器中的完整 Markdown 文本 */
  getCurrentMarkdown?: () => string
  /** 获取当前标签对应的文件名（用于展示给模型） */
  getCurrentFileName?: () => string | null
  /** 获取当前编辑器中选中的文本内容 */
  getCurrentSelectionText?: () => string | null
}

/**
 * 完整的命令上下文：各子上下文的并集。
 * 外层系统（如 useCommandSystem）只需要提供这一份，总体仍保持向后兼容。
 */
export type CommandContext = LayoutCommandContext &
  FileCommandContext &
  AppLifecycleCommandContext &
  HelpCommandContext &
  AiCommandContext

// ===== 分组命令工厂 =====

function createLayoutCommands(ctx: LayoutCommandContext): CommandRegistry {
  return {
    layout_preview_left: () => {
      ctx.setLayout('preview-left')
      ctx.setShowPreview(true)
      ctx.setStatusMessage('布局：预览在左')
    },
    layout_preview_right: () => {
      ctx.setLayout('preview-right')
      ctx.setShowPreview(true)
      ctx.setStatusMessage('布局：预览在右')
    },
    layout_editor_only: () => {
      ctx.setLayout('editor-only')
      ctx.setShowPreview(false)
      ctx.setStatusMessage('布局：仅编辑器')
    },
    layout_preview_only: () => {
      ctx.setLayout('preview-only')
      ctx.setShowPreview(true)
      ctx.setStatusMessage('布局：仅预览')
    },
    toggle_preview: () => {
      ctx.setShowPreview((v) => {
        if (!v && ctx.layout === 'editor-only') {
          ctx.setLayout('preview-right')
        }
        return !v
      })
    },
  }
}

function createFileCommands(ctx: FileCommandContext): CommandRegistry {
  return {
    new_file: () => {
      // 总是新建一个空白标签页，不打断当前未保存的标签
      ctx.createTab()
      ctx.newDocument()
    },
    save: async () => {
      await ctx.save()
    },
    save_as: async () => {
      await ctx.saveAs()
    },
    open_file: async () => {
      // 像「新建 + 打开」一样，为每个打开的文件创建独立标签
      ctx.createTab()
      const resp = await ctx.openFile()
      if (resp && resp.ok) {
        ctx.applyOpenedContent(resp.data.content)
        // 更新当前标签的路径和标题，并标记为未脏
        ctx.setFilePath(resp.data.path)
        ctx.updateActiveMeta(resp.data.path, false)
      }
    },
    open_folder: async () => {
      // 只有在确实存在未保存变更时才弹确认，避免「空文档」也被拦截
      if (ctx.hasUnsavedChanges() && !ctx.confirmLoseChanges()) return
      if (!ctx.openFolderInSidebar) {
        ctx.setStatusMessage('当前版本暂不支持 Sidebar 打开文件夹')
        return
      }
      await ctx.openFolderInSidebar()
    },
    open_recent: async () => {
      if (!ctx.handleShowRecent) {
        ctx.setStatusMessage('最近文件面板已移除，请使用菜单 File → Open Recent')
        return
      }
      await ctx.handleShowRecent()
    },
    clear_recent: async () => {
      const resp = await ctx.clearRecentAll()
      if (resp && resp.ok) {
        ctx.setStatusMessage('已清空最近文件')
      }
    },
  }
}

function createLifecycleCommands(ctx: AppLifecycleCommandContext): CommandRegistry {
  return {
    close_file: () => {
      // 优先使用 App 层的确认对话框（与 TabBar 一致）
      if (ctx.onRequestCloseCurrentTab) {
        ctx.onRequestCloseCurrentTab()
      } else {
        // 回退到基础实现
        ctx.closeCurrentTab()
      }
    },
    quit: () => {
      if (ctx.onRequestQuit) {
        ctx.onRequestQuit()
      } else {
        // 回退实现：如果有未保存变更，使用浏览器确认对话框
        if (!ctx.confirmLoseChanges()) return
        ctx.setStatusMessage('占位：Quit 未实现')
      }
    },
  }
}

function createClipboardCommands(ctx: StatusContext): CommandRegistry {
  return {
    paste: () => {
      // 粘贴由原生菜单 -> native://paste 事件负责，这里不再调用 execCommand
    },
    copy: () => {
      if (typeof document !== 'undefined') {
        try {
          const ok = document.execCommand('copy')
          if (!ok) ctx.setStatusMessage('复制未生效')
        } catch (err) {
          console.warn('execCommand copy failed', err)
          ctx.setStatusMessage('复制未生效')
        }
      } else {
        ctx.setStatusMessage('复制未生效')
      }
    },
  }
}

function createHelpCommands(ctx: HelpCommandContext): CommandRegistry {
  return {
    haomd_about: () => {
      ctx.setStatusMessage('HaoMD · 关于（占位）')
    },
    help_docs: () => {
      if (!ctx.confirmLoseChanges()) return
      ctx.newDocument()
      ctx.applyOpenedContent(usageDocs)
      // 将逻辑文件名设置为“使用说明.md”，用于窗口标题等展示
      ctx.setFilePath('使用说明.md')
      ctx.setStatusMessage('已打开使用说明')
    },
    help_release: () => {
      ctx.setStatusMessage('HaoMD · 菜单占位/帮助')
    },
    help_issue: () => {
      ctx.setStatusMessage('HaoMD · 菜单占位/帮助')
    },
    help_about: () => {
      ctx.setStatusMessage('HaoMD · 菜单占位/帮助')
    },
  }
}

function createAiCommands(ctx: AiCommandContext): CommandRegistry {
  return {
    ai_chat: async () => {
      try {
        if (!ctx.aiClient) {
          ctx.setStatusMessage('AI Chat 未配置：AI 客户端未初始化')
          return
        }
        const resp = await ctx.aiClient.openChat()
        ctx.setStatusMessage(resp.message)
        if (!resp.ok) {
          // 配置不完整时只提示状态栏，不打开对话框
          return
        }
        if (!ctx.openAiChatDialog) {
          ctx.setStatusMessage('AI Chat UI 未初始化')
          return
        }
        ctx.openAiChatDialog({ entryMode: 'chat' })
      } catch (err) {
        console.error('[commands] ai_chat error', err)
        ctx.setStatusMessage('AI Chat 调用出错，请检查控制台日志')
      }
    },
    ai_ask_file: async () => {
      if (!ctx.aiClient) {
        ctx.setStatusMessage('Ask AI About File 未配置：AI 客户端未初始化')
        return
      }
      const resp = await ctx.aiClient.askAboutFile()
      ctx.setStatusMessage(resp.message)
      if (!resp.ok) return
      if (!ctx.openAiChatDialog || !ctx.getCurrentMarkdown) {
        ctx.setStatusMessage('当前编辑器状态不可用，无法发起 Ask AI About File')
        return
      }
      const content = ctx.getCurrentMarkdown()
      const fileName = ctx.getCurrentFileName ? ctx.getCurrentFileName() ?? undefined : undefined
      ctx.openAiChatDialog({
        entryMode: 'file',
        initialContext: { type: 'file', content, fileName },
      })
    },
    ai_ask_selection: async () => {
      if (!ctx.aiClient) {
        ctx.setStatusMessage('Ask AI About Selection 未配置：AI 客户端未初始化')
        return
      }
      const resp = await ctx.aiClient.askAboutSelection()
      ctx.setStatusMessage(resp.message)
      if (!resp.ok) return
      if (!ctx.openAiChatDialog || !ctx.getCurrentSelectionText) {
        ctx.setStatusMessage('当前编辑器状态不可用，无法发起 Ask AI About Selection')
        return
      }
      const selection = ctx.getCurrentSelectionText()?.trim()
      if (!selection) {
        ctx.setStatusMessage('当前没有选中的文本')
        return
      }
      ctx.openAiChatDialog({
        entryMode: 'selection',
        initialContext: { type: 'selection', content: selection },
      })
    },
  }
}

// ===== 总的命令注册表 =====

export const createCommandRegistry = (ctx: CommandContext): CommandRegistry => ({
  ...createLayoutCommands(ctx),
  ...createFileCommands(ctx),
  ...createLifecycleCommands(ctx),
  ...createClipboardCommands(ctx),
  ...createHelpCommands(ctx),
  ...createAiCommands(ctx),
})
