/// <reference lib="webworker" />

import {
  getCachedPreviewMarkdown,
  preparePreviewMarkdown,
  preparePreviewMarkdownIncremental,
  type PreviewMarkdownResult,
} from '../modules/markdown/previewPipeline'
import { applyTextPatch, createPreviewEncoder } from '../modules/markdown/preview/previewTransport'

type PreviewWorkerRequest = {
  id: number
  value?: string
  textPatch?: { from: number; to: number; insert: string }
}

const workerScope = self as DedicatedWorkerGlobalScope
const encode = createPreviewEncoder()
let previousValue: string | null = null
let previousResult: PreviewMarkdownResult | null = null

workerScope.addEventListener('message', (event: MessageEvent<PreviewWorkerRequest>) => {
  const { id } = event.data
  let value: string
  try {
    if (typeof event.data.value === 'string') {
      value = event.data.value
    } else if (previousValue !== null && event.data.textPatch) {
      value = applyTextPatch(previousValue, event.data.textPatch)
    } else {
      throw new Error('Preview worker requires a full document snapshot')
    }
  } catch (error) {
    console.error('[MarkdownPreview] rejected input patch', error)
    return
  }
  const cached = getCachedPreviewMarkdown(value)
  const result = cached ?? (
    previousValue !== null && previousResult
      ? preparePreviewMarkdownIncremental(value, previousValue, previousResult) ?? preparePreviewMarkdown(value)
      : preparePreviewMarkdown(value)
  )
  const canReuseInputPatch = Boolean(
    event.data.textPatch && previousValue !== null && previousResult?.processedMarkdown === previousValue &&
    result.processedMarkdown === value,
  )
  previousValue = value
  previousResult = result
  workerScope.postMessage(encode(id, result, canReuseInputPatch ? event.data.textPatch : undefined))
})

export {}
