import { useEffect, useMemo, useRef, useState } from 'react'
import { createLatestTaskScheduler } from '../modules/document/taskScheduler'
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
  const [initialSignature] = useState(() => enabled && mode === 'source'
    ? getMarkdownHeadingSignature(markdown) : '')
  const renderedHeadingSignatureRef = useRef(initialSignature)
  const scheduler = useMemo(() => createLatestTaskScheduler(), [])
  useEffect(() => () => scheduler.cancel(), [scheduler, enabled, mode, documentKey])
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

    const sync = () => {
      const signature = getMarkdownHeadingSignature(markdown)
      if (!shouldSyncImmediately && signature === renderedHeadingSignatureRef.current) return
      renderedHeadingSignatureRef.current = signature
      setDebouncedMarkdown(markdown)
    }
    if (shouldSyncImmediately) {
      scheduler.cancel()
      sync()
    } else {
      scheduler.schedule(sync, {
        minIntervalMs: debounceMs, trailingDelayMs: debounceMs, maxWaitMs: Math.max(debounceMs, 1000),
      })
    }
  }, [debounceMs, documentKey, enabled, markdown, mode, scheduler])

  return useMemo(() => {
    if (!enabled || documentKey === null) {
      return []
    }
    if (mode === 'wysiwyg') {
      return buildOutlineTreeFromHeadings(wysiwygHeadings)
    }
    return buildOutlineTreeFromHeadings(buildHeadingsFromMarkdown(debouncedMarkdown))
  }, [enabled, documentKey, debouncedMarkdown, mode, wysiwygHeadings])
}
