import { useEffect, useMemo, useState } from 'react'
import type { OutlineItem } from '../modules/outline/parser'
import { buildHeadingsFromMarkdown, buildOutlineTreeFromHeadings, type OutlineHeading } from '../modules/outline/outlineSource'

export function useOutlineModel(args: {
  mode: 'source' | 'wysiwyg'
  markdown: string
  wysiwygHeadings: OutlineHeading[]
  debounceMs?: number
}): OutlineItem[] {
  const { mode, markdown, wysiwygHeadings, debounceMs = 300 } = args
  const [debouncedMarkdown, setDebouncedMarkdown] = useState(markdown)

  useEffect(() => {
    if (mode !== 'source') return
    const timer = setTimeout(() => {
      setDebouncedMarkdown(markdown)
    }, debounceMs)
    return () => clearTimeout(timer)
  }, [markdown, debounceMs, mode])

  return useMemo(() => {
    if (mode === 'wysiwyg') {
      return buildOutlineTreeFromHeadings(wysiwygHeadings)
    }
    return buildOutlineTreeFromHeadings(buildHeadingsFromMarkdown(debouncedMarkdown))
  }, [debouncedMarkdown, mode, wysiwygHeadings])
}
