import { get, set, del, keys } from 'idb-keyval'
import type { DocumentAnnotations } from '../types/annotation'

const STORE_PREFIX = 'pdf_annotations:'

export async function saveAnnotations(pdfHash: string, data: DocumentAnnotations): Promise<void> {
  await set(`${STORE_PREFIX}${pdfHash}`, data)
}

export async function loadAnnotations(pdfHash: string): Promise<DocumentAnnotations | null> {
  return (await get(`${STORE_PREFIX}${pdfHash}`)) as DocumentAnnotations | null
}

export async function deleteAnnotations(pdfHash: string): Promise<void> {
  await del(`${STORE_PREFIX}${pdfHash}`)
}

export async function listAllAnnotations(): Promise<DocumentAnnotations[]> {
  const allKeys = await keys()
  const annotationKeys = allKeys.filter((k): k is string => typeof k === 'string' && k.startsWith(STORE_PREFIX))
  const results = await Promise.all(annotationKeys.map((k) => get(k)))
  return results.filter(Boolean) as DocumentAnnotations[]
}

export async function computePdfHash(filePath: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core')
  return (await invoke<string>('compute_file_hash', { path: filePath })) as string
}
