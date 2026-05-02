import { get, set, del, keys } from 'idb-keyval'
import type { DocumentAnnotations } from '../types/annotation'
import type { BackendResult } from '../../platform/backendTypes'

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

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function hashBytes(bytes: Uint8Array) {
  const digestInput = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(digestInput).set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', digestInput)
  return bytesToHex(new Uint8Array(digest))
}

export async function computePdfHash(filePath: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core')

  try {
    return (await invoke<string>('compute_file_hash', { path: filePath })) as string
  } catch (error) {
    console.warn('[annotationStore] compute_file_hash unavailable, falling back to client hash', error)
  }

  try {
    const response = await invoke<BackendResult<number[]>>('read_binary_file', { path: filePath })
    if ('Err' in response) {
      throw new Error(response.Err.error.message)
    }
    return hashBytes(new Uint8Array(response.Ok.data))
  } catch (error) {
    console.warn('[annotationStore] read_binary_file hash fallback failed, trying fetch', error)
  }

  const response = await fetch(filePath)
  if (!response.ok) {
    throw new Error(`Failed to load PDF bytes: ${response.status} ${response.statusText}`)
  }

  return hashBytes(new Uint8Array(await response.arrayBuffer()))
}
