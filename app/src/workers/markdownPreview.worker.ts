/// <reference lib="webworker" />

import { preparePreviewMarkdown } from '../modules/markdown/previewPipeline'

type PreviewWorkerRequest = {
  id: number
  value: string
}

type PreviewWorkerResponse = {
  id: number
  processedMarkdown: string
  hasMath: boolean
}

const workerScope = self as DedicatedWorkerGlobalScope

workerScope.addEventListener('message', (event: MessageEvent<PreviewWorkerRequest>) => {
  const { id, value } = event.data
  const result = preparePreviewMarkdown(value)
  const response: PreviewWorkerResponse = {
    id,
    processedMarkdown: result.processedMarkdown,
    hasMath: result.hasMath,
  }
  workerScope.postMessage(response)
})

export {}
