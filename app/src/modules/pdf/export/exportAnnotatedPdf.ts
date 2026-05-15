import { invoke } from '@tauri-apps/api/core'
import { save as saveDialog } from '@tauri-apps/plugin-dialog'
import { computePdfHash, loadAnnotations } from '../store/annotationStore'
import { getPdfFileName } from '../annotationUtils'
import { isTauriEnv } from '../../platform/runtime'
import type { BackendResult } from '../../platform/backendTypes'
import { mapAnnotationsToExportPdfDocument } from './annotationExportMapper'

function buildAnnotatedPdfFileName(filePath: string) {
  const rawName = getPdfFileName(filePath)
  const baseName = rawName.replace(/\.pdf$/i, '')
  return `${baseName}-annotated.pdf`
}

export async function exportAnnotatedPdf(params: {
  filePath: string
  setStatusMessage: (message: string) => void
  t?: (key: string, params?: Record<string, string | number>) => string
}) {
  const { filePath, setStatusMessage, t } = params
  const tr = (key: string, fallback: string, payload?: Record<string, string | number>) =>
    t?.(key, payload) ?? fallback

  if (!isTauriEnv()) {
    throw new Error(tr('workspace.exportAnnotatedPdfUnsupported', '当前环境不支持 PDF 带批注导出'))
  }

  setStatusMessage(tr('workspace.exportAnnotatedPdfPreparing', '正在准备 PDF 批注导出...'))

  const suggestedFileName = buildAnnotatedPdfFileName(filePath)
  const outputPath = await saveDialog({
    defaultPath: suggestedFileName,
    filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
  })

  if (!outputPath) {
    setStatusMessage(tr('workspace.exportAnnotatedPdfCancelled', '已取消 PDF 批注导出'))
    return false
  }

  const pdfHash = isTauriEnv() ? await computePdfHash(filePath) : `web:${filePath}`
  const annotationDocument = await loadAnnotations(pdfHash)
  const exportDocument = mapAnnotationsToExportPdfDocument({
    sourcePath: filePath,
    fileName: getPdfFileName(filePath),
    annotationDocument,
  })

  setStatusMessage(tr('workspace.exportAnnotatedPdfRunning', '正在导出 PDF 批注...'))

  const result = await invoke<BackendResult<string>>('export_pdf_with_annotations', {
    sourcePath: filePath,
    outputPath: outputPath,
    document: exportDocument,
    traceId: null,
  })

  if ('Err' in result) {
    throw new Error(result.Err.error.message)
  }

  setStatusMessage(
    tr('workspace.exportAnnotatedPdfSuccess', 'PDF 已导出：{fileName}', {
      fileName: getPdfFileName(outputPath),
    }),
  )
  return true
}
