import type { Node as ProseMirrorNode, NodeType as ProseMirrorNodeType } from '@milkdown/prose/model'
import type { OutlineHeading } from './outlineSource'

export function buildHeadingsFromWysiwygDoc(args: {
  doc: ProseMirrorNode
  headingType: ProseMirrorNodeType
}): OutlineHeading[] {
  const { doc, headingType } = args
  const headings: OutlineHeading[] = []
  let headingIndex = 0

  doc.descendants((node) => {
    if (node.type !== headingType) return

    const level = typeof node.attrs.level === 'number' ? node.attrs.level : 1
    if (level < 1 || level > 6) return

    const text = node.textContent.trim()
    if (!text) return

    headings.push({
      id: `wysiwyg-heading-${headingIndex}`,
      text,
      level: level as 1 | 2 | 3 | 4 | 5 | 6,
      source: 'wysiwyg',
      headingIndex,
    })
    headingIndex += 1
  })

  return headings
}

/** Cache immutable subtrees. Editing a paragraph never visits its text nodes. */
export function createWysiwygOutlineReader() {
  type Heading = { text: string; level: OutlineHeading['level'] }
  let cache = new WeakMap<ProseMirrorNode, Heading[]>()
  let cachedType: ProseMirrorNodeType | null = null
  let lastHeadings: OutlineHeading[] = []
  return (doc: ProseMirrorNode, headingType: ProseMirrorNodeType): OutlineHeading[] => {
    if (cachedType !== headingType) {
      cachedType = headingType
      cache = new WeakMap()
    }
    const visit = (node: ProseMirrorNode): Heading[] => {
      const cached = cache.get(node)
      if (cached) return cached
      const headings: Heading[] = []
      if (node.type === headingType) {
        const text = node.textContent.trim()
        const level = node.attrs.level ?? 1
        if (text && level >= 1 && level <= 6) headings.push({ text, level })
      } else if (!node.isTextblock && !node.isLeaf) {
        node.forEach(child => headings.push(...visit(child)))
      }
      cache.set(node, headings)
      return headings
    }
    const headings = visit(doc)
    if (headings.length === lastHeadings.length && headings.every((heading, index) =>
      heading.text === lastHeadings[index].text && heading.level === lastHeadings[index].level)) {
      return lastHeadings
    }
    lastHeadings = headings.map((heading, index) => ({
      ...heading, id: `wysiwyg-heading-${index}`, source: 'wysiwyg', headingIndex: index,
    }))
    return lastHeadings
  }
}
