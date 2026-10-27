/// <reference lib="webworker" />

import { preparePreviewMarkdown } from '../modules/markdown/previewPipeline'
import { createPreviewEncoder } from '../modules/markdown/preview/previewTransport'

type PreviewWorkerRequest = {
  id: number
  value: string
}

const workerScope = self as DedicatedWorkerGlobalScope
const encode = createPreviewEncoder()

workerScope.addEventListener('message', (event: MessageEvent<PreviewWorkerRequest>) => {
  const { id, value } = event.data
  const result = preparePreviewMarkdown(value)
  workerScope.postMessage(encode(id, result))
})

export {}
