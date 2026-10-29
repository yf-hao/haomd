import { planOnMainThread, type RelocationPlanner, type AnalysisProgress } from './moveWorkspaceFile'

export const planWithWorker: RelocationPlanner = (documents, move, progress) => {
  if (typeof Worker === 'undefined') return planOnMainThread(documents, move)
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../../workers/fileRelocation.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<{ contents?: string[]; error?: string; progress?: AnalysisProgress }>) => {
      if (event.data.progress) { progress?.(event.data.progress); return }
      worker.terminate()
      if (event.data.error) reject(new Error(event.data.error))
      else if (event.data.contents?.length === documents.length) resolve(event.data.contents)
      else reject(new Error('文件链接分析返回了不完整结果'))
    }
    worker.onerror = () => { worker.terminate(); reject(new Error('文件链接分析失败')) }
    worker.onmessageerror = () => { worker.terminate(); reject(new Error('无法读取文件链接分析结果')) }
    try { worker.postMessage({ documents, move }) }
    catch (error) { worker.terminate(); reject(error) }
  })
}
