import type { CommandRegistry } from './types'
import { applyHeadingLevel, resetHeadingToParagraph, emphasizeSelection } from '../editor/formatService'

export type FormatCommandContext = {
  setStatusMessage: (msg: string) => void
  openInsertTableDialog?: () => void
}

export function createFormatCommands(ctx: FormatCommandContext): CommandRegistry {
  return {
    format_heading_paragraph: async () => {
      await resetHeadingToParagraph()
      ctx.setStatusMessage('已转换为段落')
    },
    format_heading_1: async () => {
      await applyHeadingLevel(1)
      ctx.setStatusMessage('已设置为 Heading 1')
    },
    format_heading_2: async () => {
      await applyHeadingLevel(2)
      ctx.setStatusMessage('已设置为 Heading 2')
    },
    format_heading_3: async () => {
      await applyHeadingLevel(3)
      ctx.setStatusMessage('已设置为 Heading 3')
    },
    format_heading_4: async () => {
      await applyHeadingLevel(4)
      ctx.setStatusMessage('已设置为 Heading 4')
    },
    format_heading_5: async () => {
      await applyHeadingLevel(5)
      ctx.setStatusMessage('已设置为 Heading 5')
    },
    format_heading_6: async () => {
      await applyHeadingLevel(6)
      ctx.setStatusMessage('已设置为 Heading 6')
    },
    format_emphasize_selection: async () => {
      await emphasizeSelection()
      ctx.setStatusMessage('已加粗选中内容')
    },
    format_insert_table: () => {
      if (ctx.openInsertTableDialog) {
        ctx.openInsertTableDialog()
      } else {
        ctx.setStatusMessage('Insert Table 尚未实现')
      }
    },
    format_insert_code_block: () => {
      ctx.setStatusMessage('Insert Code Block 尚未实现')
    },
  }
}
