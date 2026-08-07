/// <reference lib="webworker" />

import { preparePreviewMarkdown } from '../modules/markdown/previewPipeline'

type PreviewWorkerRequest = {
  id: number
  value: string
  traceId: number | null
  inputAt: number | null
  debounceAt: number | null
}

type PreviewWorkerResponse = {
  id: number
  processedMarkdown: string
  hasMath: boolean
  containsToc: boolean
  sourceLineOffset: number
  lineCount: number
  traceId: number | null
  blockChunks: Array<{
    id: string
    startLine: number
    endLine: number
    markdown: string
    signature: string
  }>
}

const workerScope = self as DedicatedWorkerGlobalScope

workerScope.addEventListener('message', (event: MessageEvent<PreviewWorkerRequest>) => {
  const { id, value } = event.data
  const result = preparePreviewMarkdown(value)
  const response: PreviewWorkerResponse = {
    id,
    processedMarkdown: result.processedMarkdown,
    hasMath: result.hasMath,
    containsToc: result.containsToc,
    sourceLineOffset: result.sourceLineOffset,
    lineCount: result.lineCount,
    traceId: event.data.traceId,
    blockChunks: result.blockChunks,
  }
  workerScope.postMessage(response)
})

export {}
