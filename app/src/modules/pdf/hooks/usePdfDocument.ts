import { useEffect, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker?worker&url'
import { invoke } from '@tauri-apps/api/core'
import { isTauriEnv } from '../../platform/runtime'
import type { BackendResult } from '../../platform/backendTypes'

// 配置 PDF.js worker，避免在部分环境下因找不到默认 worker 而报错
;(pdfjsLib as any).GlobalWorkerOptions.workerSrc = pdfWorker

const isTauri = isTauriEnv

// 在这里用 any 代替具体类型，避免对 pdfjs 内部类型路径的强依赖
export type PDFDocumentProxy = any

export function usePdfDocument(filePath: string | null) {
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      if (!filePath) {
        setPdfDocument(null)
        setPageCount(0)
        setError(null)
        return
      }

      setLoading(true)
      setError(null)

      try {
        let loadingTask: any

        if (isTauri && isTauri()) {
          const resp = await invoke<BackendResult<number[]>>('read_binary_file', { path: filePath })
          if ('Err' in resp) {
            console.error('[usePdfDocument] read_binary_file failed', resp.Err.error)
            throw new Error(resp.Err.error.message)
          }
          const bytes = new Uint8Array(resp.Ok.data)
          loadingTask = pdfjsLib.getDocument({ data: bytes })
        } else {
          // 浏览器环境：期望 filePath 是可访问的 URL
          loadingTask = pdfjsLib.getDocument({ url: filePath })
        }

        const doc = await loadingTask.promise
        if (cancelled) return
        setPdfDocument(doc)
        setPageCount(doc.numPages ?? 0)
      } catch (e) {
        if (cancelled) return
        console.error('[usePdfDocument] failed to load pdf', { filePath, error: e })
        setError('Failed to load PDF')
        setPdfDocument(null)
        setPageCount(0)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [filePath])

  return { pdfDocument, pageCount, loading, error }
}
