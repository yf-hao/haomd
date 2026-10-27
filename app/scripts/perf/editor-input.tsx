import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import type { EditorView } from '@codemirror/view'
import { CodeEditor } from '../../src/components/Editor/CodeEditor'
import { MarkdownViewer } from '../../src/components/MarkdownViewer'
import { ThemeModeProvider } from '../../src/modules/theme/ThemeContext'
import { lightTheme } from '../../src/modules/theme/themes/lightTheme'
import { createPreviewScheduler } from '../../src/modules/markdown/preview/previewScheduler'

// Isolated production-build benchmark of the actual editor/preview components.
// The desktop shell and native IME still need separate WebView verification.
let view: EditorView | null = null
let reset: (value: string, preview: boolean) => void
const samples: number[] = []
const inputTimes: number[] = []
const previewDelays: number[] = []
let observedInputs = 0
let previewUpdates = 0
let previewObserver: MutationObserver | null = null
let fullReads = 0
let workerStarts = 0
const NativeWorker = window.Worker
window.Worker = class extends NativeWorker {
  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options)
    workerStarts++
  }
}

function Harness() {
  const [source, setSource] = useState('')
  const [preview, setPreview] = useState('')
  const [visible, setVisible] = useState(false)
  const [documentId, setDocumentId] = useState(0)
  const scheduler = useMemo(() => createPreviewScheduler(), [])
  reset = (value, showPreview) => {
    setSource(value)
    setPreview(value)
    setVisible(showPreview)
    setDocumentId(id => id + 1)
  }
  return <div style={{ display: 'flex', height: '90vh' }}>
    <div style={{ width: '50%', height: '100%' }}>
      <CodeEditor value={source} documentKey={String(documentId)} preserveLocalDocument
        onViewReady={next => { view = next }} onDocumentChange={change => {
          if (!visible) return
          const doc = ('view' in change ? change.view : change).state.doc
          scheduler.schedule(() => {
            setPreview(doc.toString())
          })
        }} />
    </div>
    {visible && <div style={{ width: '50%', overflow: 'auto' }}><MarkdownViewer value={preview} /></div>}
  </div>
}

createRoot(document.getElementById('root')!).render(
  <ThemeModeProvider value={{ selectedMode: 'light', resolvedMode: 'light',
    themeSettings: { mode: 'light' }, activeTheme: lightTheme }}><Harness /></ThemeModeProvider>,
)

Object.assign(window, { editorBenchmark: {
  async setup(size: number, preview: boolean) {
    const paragraph = '## 标题\n\n这是一段用于长文档输入性能验证的中文正文，包含普通文本和 Markdown。\n\n'
    flushSync(() => reset(paragraph.repeat(Math.ceil(size / paragraph.length)).slice(0, size), preview))
    await new Promise(resolve => setTimeout(resolve, 500))
    view!.dispatch({ selection: { anchor: view!.state.doc.length }, scrollIntoView: true })
    const prototype = Object.getPrototypeOf(view!.state.doc)
    const original = prototype.toString
    prototype.toString = function () {
      if (this.length >= size) fullReads++
      return original.call(this)
    }
    samples.length = 0
    inputTimes.length = 0
    previewDelays.length = 0
    observedInputs = 0
    previewUpdates = 0
    fullReads = 0
    workerStarts = 0
    previewObserver?.disconnect()
    const previewElement = document.querySelector('.markdown-body')
    if (previewElement) {
      previewObserver = new MutationObserver(() => {
        // Inspect only the last leaf; collecting the full preview text would skew timing.
        let leaf: Node = previewElement
        while (leaf.lastChild) leaf = leaf.lastChild
        const count = leaf.textContent?.match(/字+\s*$/)?.[0].trim().length ?? 0
        if (count <= observedInputs) return
        const now = performance.now()
        for (let index = observedInputs; index < Math.min(count, inputTimes.length); index++) {
          previewDelays.push(now - inputTimes[index])
        }
        observedInputs = count
        previewUpdates++
      })
      previewObserver.observe(previewElement, { childList: true, characterData: true, subtree: true })
    }
  },
  type() {
    const start = performance.now()
    inputTimes.push(start)
    view!.dispatch({ changes: { from: view!.state.doc.length, insert: '字' }, scrollIntoView: true })
    samples.push(performance.now() - start)
  },
  results() {
    const sorted = [...samples].sort((a, b) => a - b)
    const previewSorted = [...previewDelays].sort((a, b) => a - b)
    return { samples: sorted.length, dispatchP95Ms: sorted[Math.floor(sorted.length * 0.95)],
      dispatchMaxMs: sorted.at(-1), fullReads, workerStarts,
      previewCommitP95Ms: previewSorted[Math.floor(previewSorted.length * 0.95)] ?? null,
      previewCommitMaxMs: previewSorted.at(-1) ?? null, reflectedInputs: previewSorted.length, previewUpdates }
  },
} })
