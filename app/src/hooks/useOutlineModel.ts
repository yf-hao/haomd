import { useEffect, useMemo, useRef, useState } from 'react'
import type { OutlineItem } from '../modules/outline/parser'
import {
  buildHeadingsFromMarkdown,
  buildOutlineTreeFromHeadings,
  getMarkdownHeadingSignature,
  type OutlineHeading,
} from '../modules/outline/outlineSource'

export function useOutlineModel(args: {
  mode: 'source' | 'wysiwyg'
  markdown: string
  wysiwygHeadings: OutlineHeading[]
  enabled?: boolean
  debounceMs?: number
  documentKey?: string | null
}): OutlineItem[] {
  const {
    mode,
    markdown,
    wysiwygHeadings,
    enabled = true,
    debounceMs = 300,
    documentKey,
  } = args
  const [debouncedMarkdown, setDebouncedMarkdown] = useState(markdown)
  const markdownHeadingSignature = useMemo(
    () => (enabled && mode === 'source' ? getMarkdownHeadingSignature(markdown) : ''),
    [enabled, markdown, mode],
  )
  const renderedHeadingSignatureRef = useRef(markdownHeadingSignature)
  const previousContextRef = useRef({
    enabled,
    mode,
    documentKey,
  })

  useEffect(() => {
    const previous = previousContextRef.current
    previousContextRef.current = { enabled, mode, documentKey }

    if (!enabled || mode !== 'source') return
    if (documentKey === null) {
      renderedHeadingSignatureRef.current = ''
      setDebouncedMarkdown('')
      return
    }

    const shouldSyncImmediately =
      !previous.enabled ||
      previous.mode !== mode ||
      previous.documentKey !== documentKey

    if (shouldSyncImmediately) {
      renderedHeadingSignatureRef.current = markdownHeadingSignature
      setDebouncedMarkdown(markdown)
      return
    }

    if (markdownHeadingSignature === renderedHeadingSignatureRef.current) return

    const timer = setTimeout(() => {
      renderedHeadingSignatureRef.current = markdownHeadingSignature
      setDebouncedMarkdown(markdown)
    }, debounceMs)
    return () => clearTimeout(timer)
  }, [debounceMs, documentKey, enabled, markdown, markdownHeadingSignature, mode])

  return useMemo(() => {
    if (!enabled || documentKey === null) {
      return []
    }
    if (mode === 'wysiwyg') {
      return buildOutlineTreeFromHeadings(wysiwygHeadings)
    }
    return buildOutlineTreeFromHeadings(buildHeadingsFromMarkdown(debouncedMarkdown))
  }, [enabled, debouncedMarkdown, mode, wysiwygHeadings])
}
