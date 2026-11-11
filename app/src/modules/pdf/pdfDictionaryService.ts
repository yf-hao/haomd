import { invoke } from '@tauri-apps/api/core'

export type PdfDictionaryInfo = {
  path: string
  title: string
  entries: number
}

export type PdfDictionaryRecord = {
  key: string
  html: string
}

export function openPdfDictionary(mdxPath: string): Promise<PdfDictionaryInfo> {
  return invoke('open_pdf_dictionary', { mdxPath })
}

export function lookupPdfDictionary(mdxPath: string, word: string): Promise<PdfDictionaryRecord | null> {
  return invoke('lookup_pdf_dictionary', { mdxPath, word })
}

export function readPdfDictionaryAudio(mdxPath: string, resourceKey: string): Promise<string | null> {
  return invoke('read_pdf_dictionary_audio', { mdxPath, resourceKey })
}
