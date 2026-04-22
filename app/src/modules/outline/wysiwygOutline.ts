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
