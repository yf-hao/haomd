import { useEffect, useMemo, useState } from 'react'
import type { OutlineItem } from '../modules/outline/parser'
import { buildHeadingsFromMarkdown, buildOutlineTreeFromHeadings, type OutlineHeading } from '../modules/outline/outlineSource'

export function useOutlineModel(args: {
  mode: 'source' | 'wysiwyg'
  markdown: string
  wysiwygHeadings: OutlineHeading[]
  enabled?: boolean
  debounceMs?: number
}): OutlineItem[] {
  const { mode, markdown, wysiwygHeadings, enabled = true, debounceMs = 300 } = args
  const [debouncedMarkdown, setDebouncedMarkdown] = useState(markdown)

  useEffect(() => {
    if (!enabled) return
    setDebouncedMarkdown(markdown)
  }, [enabled, markdown])

  useEffect(() => {
    if (!enabled) return
    if (mode !== 'source') return
    const timer = setTimeout(() => {
      setDebouncedMarkdown(markdown)
    }, debounceMs)
    return () => clearTimeout(timer)
  }, [enabled, markdown, debounceMs, mode])

  return useMemo(() => {
    if (!enabled) {
      return []
    }
    if (mode === 'wysiwyg') {
      return buildOutlineTreeFromHeadings(wysiwygHeadings)
    }
    return buildOutlineTreeFromHeadings(buildHeadingsFromMarkdown(debouncedMarkdown))
  }, [enabled, debouncedMarkdown, mode, wysiwygHeadings])
}
