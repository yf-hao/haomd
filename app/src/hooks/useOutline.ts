import { useMemo } from 'react'
import { buildOutlineFromMarkdown, type OutlineItem } from '../modules/outline/parser'

export function useOutline(markdown: string): OutlineItem[] {
  return useMemo(() => buildOutlineFromMarkdown(markdown), [markdown])
}
