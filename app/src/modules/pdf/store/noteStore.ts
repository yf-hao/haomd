import { del, get, set } from 'idb-keyval'
import type { PdfNote } from '../types/note'

const STORE_PREFIX = 'pdf_notes:'

export async function saveNotes(pdfHash: string, notes: PdfNote[]): Promise<void> {
  await set(`${STORE_PREFIX}${pdfHash}`, notes)
}

export async function loadNotes(pdfHash: string): Promise<PdfNote[]> {
  return ((await get(`${STORE_PREFIX}${pdfHash}`)) as PdfNote[] | null) ?? []
}

export async function deleteNotes(pdfHash: string): Promise<void> {
  await del(`${STORE_PREFIX}${pdfHash}`)
}
