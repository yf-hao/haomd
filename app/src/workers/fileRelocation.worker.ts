/// <reference lib="webworker" />
import { relocateMarkdown, type FileRelocation } from '../modules/markdown/references/relocationPlanner'
import type { MoveDocument } from '../modules/files/ports/fileMovePort'

self.onmessage = (event: MessageEvent<{ documents: MoveDocument[]; move: FileRelocation }>) => {
  try {
    const contents: string[] = []
    let lastProgress = performance.now()
    const { documents, move } = event.data
    for (const document of documents) {
      contents.push(relocateMarkdown(document.content, document.path, move, true))
      const now = performance.now()
      if (now - lastProgress >= 250 || contents.length === documents.length) {
        self.postMessage({ progress: { completed: contents.length, total: documents.length } })
        lastProgress = now
      }
    }
    self.postMessage({ contents })
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }) }
}
