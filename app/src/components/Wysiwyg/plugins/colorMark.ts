import { $markSchema, $remark } from '@milkdown/utils'
import { normalizeTextColor, remarkTextColorSyntax } from '../../../modules/markdown/extensions/colorMark'

export const remarkTextColorPlugin = $remark('remarkTextColor', () => remarkTextColorSyntax as any)

export const textColorMark = $markSchema('text_color', () => ({
  attrs: {
    color: {
      default: '#ef4444',
      validate: 'string',
    },
  },
  parseDOM: [
    {
      tag: 'span[data-text-color]',
      getAttrs: (dom) => {
        if (!(dom instanceof HTMLElement)) return false
        const color = normalizeTextColor(dom.dataset.textColor ?? dom.style.color)
        if (!color) return false
        return { color }
      },
    },
  ],
  toDOM: (mark) => {
    const color = normalizeTextColor(String(mark.attrs.color)) ?? '#ef4444'
    return ['span', { 'data-text-color': color, style: `color:${color}` }, 0]
  },
  parseMarkdown: {
    match: (node) => node.type === 'textColor',
    runner: (state, node, markType) => {
      const color = normalizeTextColor(String(node.color ?? ''))
      if (!color) {
        state.next(node.children)
        return
      }
      state.openMark(markType, { color })
      state.next(node.children)
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'text_color',
    runner: (state, mark) => {
      const color = normalizeTextColor(String(mark.attrs.color))
      if (!color) return false
      state.withMark(mark, 'textColor', undefined, { color })
      return true
    },
  },
}))

export const colorMarkPlugin = [remarkTextColorPlugin, textColorMark].flat()
