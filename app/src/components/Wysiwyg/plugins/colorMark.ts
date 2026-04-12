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
      if (!color) return
      // Do NOT return true here — that would prevent #runProseNode from being
      // called, which means the wrapped text node would never be added as a
      // child of the textColor mdast node, producing empty `{color:...}{/color}`.
      // Like `strong`, we let the text node be serialized as a normal child.
      state.withMark(mark, 'textColor', undefined, { color })
    },
  },
}))

export const colorMarkPlugin = [remarkTextColorPlugin, textColorMark].flat()
