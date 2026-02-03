export type AppCommand = () => void | Promise<void>

export type CommandRegistry = Record<string, AppCommand>

export type CommandContext = {
  layout: string
  setLayout: (layout: string) => void
  setShowPreview: (value: boolean | ((prev: boolean) => boolean)) => void
  setStatusMessage: (msg: string) => void
  confirmLoseChanges: () => boolean
  newDocument: () => void
  applyOpenedContent: (content: string) => void
  openFile: () => Promise<any>
  save: () => Promise<any>
  saveAs: () => Promise<any>
  handleShowRecent: () => Promise<void>
  clearRecentAll: () => Promise<any>
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
    if (!ctx.confirmLoseChanges()) return
    ctx.newDocument()
    ctx.applyOpenedContent('')
  },
  save: async () => {
    await ctx.save()
  },
  save_as: async () => {
    await ctx.saveAs()
  },
  open_file: async () => {
    const resp = await ctx.openFile()
    if (resp && resp.ok) {
      ctx.applyOpenedContent(resp.data.content)
    }
  },
  open_folder: () => {
    if (!ctx.confirmLoseChanges()) return
    ctx.setStatusMessage('占位：Open Folder 未实现')
  },
  open_recent: async () => {
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
    ctx.setStatusMessage('HaoMD · 菜单占位/帮助')
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
