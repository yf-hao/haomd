import type { CommandRegistry } from './types'
import {
  applyHeadingLevel,
  resetHeadingToParagraph,
  emphasizeSelection,
  toggleStrikethrough,
  insertCodeBlock,
  applyTextColor,
  clearTextColor,
  getCurrentTextColor,
  getCurrentTextColorTarget,
  applyTextColorToTarget,
} from '../editor/formatService'
import { MATH_CAT_PREFIX, MATH_CATEGORIES } from '../editor/mathSymbols'
import { getNextTextColor } from '../editor/textColorCycle'

export type FormatCommandContext = {
  setStatusMessage: (msg: string) => void
  openInsertTableDialog?: () => void
  openMathSymbolDialog?: (categoryKey: string) => void
  openTextColorDialog?: () => void
  insertWordTemplateFrontMatter?: () => void
  t?: (key: string, params?: Record<string, string | number>) => string
}

let textColorCycleRunning = false

const tr = (
  ctx: FormatCommandContext,
  key: string,
  fallback: string,
  params?: Record<string, string | number>,
) => ctx.t?.(key, params) ?? fallback

export function createFormatCommands(ctx: FormatCommandContext): CommandRegistry {
  return {
    format_heading_paragraph: async () => {
      await resetHeadingToParagraph()
      ctx.setStatusMessage(tr(ctx, 'commands.formatParagraph', '已转换为段落'))
    },
    format_heading_1: async () => {
      await applyHeadingLevel(1)
      ctx.setStatusMessage(tr(ctx, 'commands.formatHeading', '已设置为 Heading 1', { level: 1 }))
    },
    format_heading_2: async () => {
      await applyHeadingLevel(2)
      ctx.setStatusMessage(tr(ctx, 'commands.formatHeading', '已设置为 Heading 2', { level: 2 }))
    },
    format_heading_3: async () => {
      await applyHeadingLevel(3)
      ctx.setStatusMessage(tr(ctx, 'commands.formatHeading', '已设置为 Heading 3', { level: 3 }))
    },
    format_heading_4: async () => {
      await applyHeadingLevel(4)
      ctx.setStatusMessage(tr(ctx, 'commands.formatHeading', '已设置为 Heading 4', { level: 4 }))
    },
    format_heading_5: async () => {
      await applyHeadingLevel(5)
      ctx.setStatusMessage(tr(ctx, 'commands.formatHeading', '已设置为 Heading 5', { level: 5 }))
    },
    format_heading_6: async () => {
      await applyHeadingLevel(6)
      ctx.setStatusMessage(tr(ctx, 'commands.formatHeading', '已设置为 Heading 6', { level: 6 }))
    },
    format_emphasize_selection: async () => {
      await emphasizeSelection()
      ctx.setStatusMessage(tr(ctx, 'commands.formatBold', '已加粗选中内容'))
    },
    format_strikethrough: async () => {
      await toggleStrikethrough()
      ctx.setStatusMessage(tr(ctx, 'commands.formatStrikethrough', '已添加删除线'))
    },
    format_text_color_red: async () => {
      await applyTextColor('#ef4444')
      ctx.setStatusMessage(tr(ctx, 'commands.formatTextColorApplied', '已设置文字颜色', { color: '#ef4444' }))
    },
    format_text_color_orange: async () => {
      await applyTextColor('#f97316')
      ctx.setStatusMessage(tr(ctx, 'commands.formatTextColorApplied', '已设置文字颜色', { color: '#f97316' }))
    },
    format_text_color_yellow: async () => {
      await applyTextColor('#eab308')
      ctx.setStatusMessage(tr(ctx, 'commands.formatTextColorApplied', '已设置文字颜色', { color: '#eab308' }))
    },
    format_text_color_green: async () => {
      await applyTextColor('#22c55e')
      ctx.setStatusMessage(tr(ctx, 'commands.formatTextColorApplied', '已设置文字颜色', { color: '#22c55e' }))
    },
    format_text_color_cyan: async () => {
      await applyTextColor('#06b6d4')
      ctx.setStatusMessage(tr(ctx, 'commands.formatTextColorApplied', '已设置文字颜色', { color: '#06b6d4' }))
    },
    format_text_color_blue: async () => {
      await applyTextColor('#3b82f6')
      ctx.setStatusMessage(tr(ctx, 'commands.formatTextColorApplied', '已设置文字颜色', { color: '#3b82f6' }))
    },
    format_text_color_purple: async () => {
      await applyTextColor('#a855f7')
      ctx.setStatusMessage(tr(ctx, 'commands.formatTextColorApplied', '已设置文字颜色', { color: '#a855f7' }))
    },
    format_text_color_cycle: async () => {
      if (textColorCycleRunning) return
      textColorCycleRunning = true
      try {
      const target = await getCurrentTextColorTarget()
      if (!target) return

      const nextColor = getNextTextColor(await getCurrentTextColor())
      const applied = await applyTextColorToTarget(nextColor, target)
      if (!applied) return

      if (nextColor) {
        ctx.setStatusMessage(tr(ctx, 'commands.formatTextColorApplied', '已设置文字颜色', { color: nextColor }))
        return
      }
      ctx.setStatusMessage(tr(ctx, 'commands.formatTextColorCleared', '已清除文字颜色'))
      } finally {
        textColorCycleRunning = false
      }
    },
    format_text_color_custom: () => {
      ctx.openTextColorDialog?.()
    },
    format_text_color_clear: async () => {
      await clearTextColor()
      ctx.setStatusMessage(tr(ctx, 'commands.formatTextColorCleared', '已清除文字颜色'))
    },
    format_insert_table: () => {
      if (ctx.openInsertTableDialog) {
        ctx.openInsertTableDialog()
      } else {
        ctx.setStatusMessage(tr(ctx, 'commands.insertTableUnavailable', 'Insert Table 尚未实现'))
      }
    },
    format_insert_code_block: async () => {
      await insertCodeBlock()
    },
    format_insert_front_matter: () => {
      if (!ctx.insertWordTemplateFrontMatter) {
        ctx.setStatusMessage(tr(ctx, 'commands.insertFrontMatterUnavailable', '当前版本未注册 Front Matter 插入能力'))
        return
      }
      ctx.insertWordTemplateFrontMatter()
      ctx.setStatusMessage(
        tr(
          ctx,
          'commands.insertFrontMatterApplied',
          '已在文档头部插入 Front Matter，并设置 word_template: default_plan',
        ),
      )
    },
    // Math symbol category commands — open dialog with the selected category
    ...Object.fromEntries(
      MATH_CATEGORIES.map((cat) => [
        `${MATH_CAT_PREFIX}${cat.key}`,
        () => {
          if (ctx.openMathSymbolDialog) {
            ctx.openMathSymbolDialog(cat.key)
          }
        },
      ]),
    ),
  }
}
