/**
 * Milkdown math plugin: integrates remark-math for parsing $...$ / $$...$$ delimiters,
 * and defines ProseMirror nodes for block and inline math.
 *
 * Rendering is handled by separate React node views (MathBlockView / InlineMathView).
 */
import { $nodeSchema, $remark, $node, $inputRule, $prose } from '@milkdown/kit/utils'
import { InputRule } from '@milkdown/prose/inputrules'
import type {
  Node as ProseMirrorNode,
  NodeType as ProseMirrorNodeType,
} from '@milkdown/prose/model'
import {
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type Transaction,
} from '@milkdown/prose/state'
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

type MathDisplayInputCandidate = {
  from: number
  to: number
  value: string
}

function getMathDisplayValue(lines: string[]): string | null {
  if (lines.length === 0) return null

  const firstLine = lines[0]!
  const lastLine = lines[lines.length - 1]!
  if (!firstLine.startsWith('$$') || !lastLine.endsWith('$$')) return null

  if (lines.length === 1) {
    if (firstLine.length <= 4) return null
    return firstLine.slice(2, -2)
  }

  const valueLines: string[] = []
  const firstValue = firstLine.slice(2)
  const lastValue = lastLine.slice(0, -2)
  if (firstValue) valueLines.push(firstValue)
  valueLines.push(...lines.slice(1, -1))
  if (lastValue) valueLines.push(lastValue)
  return valueLines.join('\n')
}

function findMathDisplayInputCandidate(
  doc: ProseMirrorNode,
  cursorPos: number,
): MathDisplayInputCandidate | null {
  const paragraphs: Array<{
    node: ProseMirrorNode
    pos: number
    parent: ProseMirrorNode
  }> = []

  doc.descendants((node, pos, parent) => {
    if (node.type.name === 'paragraph' && parent) {
      paragraphs.push({ node, pos, parent })
    }
    return true
  })

  for (let index = 0; index < paragraphs.length; index += 1) {
    const opening = paragraphs[index]!
    const openingText = opening.node.textContent
    if (!openingText.startsWith('$$')) continue

    const lines = [openingText]
    let closing = opening

    for (let nextIndex = index + 1; nextIndex < paragraphs.length; nextIndex += 1) {
      const next = paragraphs[nextIndex]!
      if (next.parent !== opening.parent) break
      if (next.pos !== closing.pos + closing.node.nodeSize) break

      lines.push(next.node.textContent)
      closing = next
      if (next.node.textContent.endsWith('$$')) break
    }

    if (!lines[lines.length - 1]!.endsWith('$$')) continue

    const value = getMathDisplayValue(lines)
    if (value === null) continue

    const from = opening.pos
    const to = closing.pos + closing.node.nodeSize
    if (cursorPos < from || cursorPos > to) continue

    return { from, to, value }
  }

  return null
}

function placeCursorAfterMathBlock(
  tr: Transaction,
  blockPos: number,
  node: ProseMirrorNode,
) {
  const after = blockPos + node.nodeSize
  const paragraphType = tr.doc.type.schema.nodes.paragraph
  if (!tr.doc.nodeAt(after) && paragraphType) {
    tr.insert(after, paragraphType.create())
  }
  return tr.setSelection(Selection.near(tr.doc.resolve(after), 1))
}

export function createMathInlineInputRule(nodeType: ProseMirrorNodeType): InputRule {
  return new InputRule(
    /(?:^|[\s([{])\$([^$\n]+)\$$/,
    (state, match, _start, end) => {
      const value = match[1]
      if (!value || value.trim() === '') return null

      const from = end - value.length - 2
      const node = nodeType.create(null, state.schema.text(value))
      const tr = state.tr.replaceWith(from, end, node)
      return tr.setSelection(TextSelection.create(tr.doc, from + node.nodeSize))
    },
    { inCodeMark: false },
  )
}

const mathInlineInputRule = $inputRule((ctx) =>
  createMathInlineInputRule(mathInlineNode.type(ctx)),
)

export function createMathBlockInputRule(nodeType: ProseMirrorNodeType): InputRule {
  return new InputRule(
    /^\$\$([\s\S]+)\$\$$/,
    (state, match, start) => {
      const value = match[1]
      if (!value || value.trim() === '') return null

      const $start = state.doc.resolve(start)
      if ($start.parent.type.name !== 'paragraph') return null

      const node = nodeType.create(null, state.schema.text(value))
      const tr = state.tr.replaceWith($start.before(), $start.after(), node)
      return placeCursorAfterMathBlock(tr, $start.before(), node)
    },
    { inCodeMark: false },
  )
}

const mathBlockInputRule = $inputRule((ctx) =>
  createMathBlockInputRule(mathBlockSchema.type(ctx)),
)

export function createMathDisplayInputPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey('HAOMD_MATH_DISPLAY_INPUT'),
    props: {
      handleTextInput: (view, from, to, text) => {
        const inserted = view.state.tr.insertText(text, from, to)
        const candidate = findMathDisplayInputCandidate(inserted.doc, inserted.selection.from)
        if (!candidate) return false

        const mathType = inserted.doc.type.schema.nodes.math_display
        if (!mathType) return false

        const node = mathType.create(
          null,
          candidate.value ? inserted.doc.type.schema.text(candidate.value) : undefined,
        )
        const tr = inserted.replaceWith(candidate.from, candidate.to, node)
        view.dispatch(placeCursorAfterMathBlock(tr, candidate.from, node))
        return true
      },
    },
  })
}

const mathDisplayInputPlugin = $prose(() => createMathDisplayInputPlugin())

/* ---------- Exported plugin array ---------- */

export const mathPlugin = [
  remarkMathPlugin,
  mathBlockSchema,
  mathInlineNode,
  mathDisplayInputPlugin,
  mathBlockInputRule,
  mathInlineInputRule,
].flat()
