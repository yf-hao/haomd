/**
 * Milkdown math plugin: integrates remark-math for parsing $...$ / $$...$$ delimiters,
 * and defines ProseMirror nodes for block and inline math.
 *
 * Rendering is handled by separate React node views (MathBlockView / InlineMathView).
 */
import { $nodeSchema, $remark, $node } from '@milkdown/kit/utils'
import remarkMath from 'remark-math'

/* ---------- remark-math integration ---------- */

export const remarkMathPlugin = $remark('remarkMath', () => remarkMath as any)

/* ---------- Block math node: $$...$$ ---------- */

export const mathBlockSchema = $nodeSchema('math_display', () => ({
  group: 'block',
  content: 'text*',
  marks: '',
  defining: true,
  code: true,
  atom: false,
  attrs: {},
  parseDOM: [
    {
      tag: 'div.math-display',
      preserveWhitespace: 'full' as const,
    },
  ],
  toDOM: () => ['div', { class: 'math-display' }, 0],
  parseMarkdown: {
    match: (node) => node.type === 'math',
    runner: (state, node, type) => {
      const value = (node.value as string) || ''
      state.openNode(type)
      if (value) state.addText(value)
      state.closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'math_display',
    runner: (state, node) => {
      const text = node.textContent || ''
      state.addNode('math', undefined, text)
    },
  },
}))

/* ---------- Inline math node: $...$ ---------- */

export const mathInlineNode = $node('math_inline', () => ({
  group: 'inline',
  content: 'text*',
  marks: '',
  inline: true,
  atom: false,
  code: true,
  defining: true,
  parseDOM: [
    {
      tag: 'span.math-inline',
      preserveWhitespace: 'full' as const,
    },
  ],
  toDOM: () => ['span', { class: 'math-inline' }, 0],
  parseMarkdown: {
    match: (node) => node.type === 'inlineMath',
    runner: (state, node, type) => {
      const value = (node.value as string) || ''
      state.openNode(type)
      if (value) state.addText(value)
      state.closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'math_inline',
    runner: (state, node) => {
      const text = node.textContent || ''
      state.addNode('inlineMath', undefined, text)
    },
  },
}))

/* ---------- Exported plugin array ---------- */

export const mathPlugin = [
  remarkMathPlugin,
  mathBlockSchema,
  mathInlineNode,
].flat()
