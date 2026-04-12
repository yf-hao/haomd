import { get, set } from 'idb-keyval'
import type { WebLiteNote } from '../domain/models'
import { DB_KEYS, webLiteStore } from './indexedDb'

async function loadAll(): Promise<WebLiteNote[]> {
  return (await get<WebLiteNote[]>(DB_KEYS.notes, webLiteStore)) ?? []
}

async function saveAll(notes: WebLiteNote[]): Promise<void> {
  await set(DB_KEYS.notes, notes, webLiteStore)
}

export const notesRepoWeb = {
  async listNotes(): Promise<WebLiteNote[]> {
    const notes = await loadAll()
    return notes
      .filter((note) => !note.deletedAt)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  },

  async listAllNotes(): Promise<WebLiteNote[]> {
    const notes = await loadAll()
    return notes.sort((a, b) => b.updatedAt - a.updatedAt)
  },

  async getNote(id: string): Promise<WebLiteNote | null> {
    const notes = await loadAll()
    const note = notes.find((item) => item.id === id) ?? null
    if (!note || note.deletedAt) return null
    return note
  },

  async saveNote(note: WebLiteNote): Promise<void> {
    const notes = await loadAll()
    const next = notes.some((item) => item.id === note.id)
      ? notes.map((item) => (item.id === note.id ? note : item))
      : [...notes, note]
    await saveAll(next)
  },

  async deleteNote(id: string): Promise<void> {
    const notes = await loadAll()
    const now = Date.now()
    await saveAll(
      notes.map((note) =>
        note.id === id
          ? {
              ...note,
              updatedAt: now,
              deletedAt: now,
            }
          : note,
      ),
    )
  },

  async replaceAllNotes(notes: WebLiteNote[]): Promise<void> {
    await saveAll(notes)
  },

  async createNote(): Promise<WebLiteNote> {
    const now = Date.now()
    const note: WebLiteNote = {
      id: crypto.randomUUID(),
      title: '未命名随笔',
      content: '',
      createdAt: now,
      updatedAt: now,
    }
    await this.saveNote(note)
    return note
  },
}
