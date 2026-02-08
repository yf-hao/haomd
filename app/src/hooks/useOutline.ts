import { useMemo } from 'react'
import { buildOutlineFromMarkdown, buildOutlineTree, type OutlineItem } from '../modules/outline/parser'

export function useOutline(markdown: string): OutlineItem[] {
  return useMemo(() => {
    const items = buildOutlineFromMarkdown(markdown)
    return buildOutlineTree(items)
  }, [markdown])
}
