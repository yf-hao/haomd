import usageDocs from '../../docs/使用说明.md?raw'

export type AppCommand = () => void | Promise<void>

export type CommandRegistry = Record<string, AppCommand>

export type CommandContext = {
  layout: string
  setLayout: (layout: string) => void
  setShowPreview: (value: boolean | ((prev: boolean) => boolean)) => void
  setStatusMessage: (msg: string) => void
  confirmLoseChanges: () => boolean
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
}

export const createCommandRegistry = (ctx: CommandContext): CommandRegistry => ({
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
  haomd_about: () => {
    ctx.setStatusMessage('HaoMD · 关于（占位）')
  },
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
  open_folder: () => {
    if (!ctx.confirmLoseChanges()) return
    ctx.setStatusMessage('占位：Open Folder 未实现')
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
  close_file: () => {
    if (!ctx.confirmLoseChanges()) return
    ctx.setStatusMessage('占位：Close File 未实现')
  },
  quit: () => {
    if (!ctx.confirmLoseChanges()) return
    ctx.setStatusMessage('占位：Quit 未实现')
  },
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
  toggle_preview: () => {
    ctx.setShowPreview((v) => {
      if (!v && ctx.layout === 'editor-only') {
        ctx.setLayout('preview-right')
      }
      return !v
    })
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
})
