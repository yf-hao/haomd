import { useCallback, useEffect, useState } from 'react'
import type { WebLiteNote } from '../domain/models'
import { notesRepoWeb } from '../storage/notesRepo.web'

export function useWebNotes() {
  const [notes, setNotes] = useState<WebLiteNote[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setNotes(await notesRepoWeb.listNotes())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const createNote = useCallback(async () => {
    const note = await notesRepoWeb.createNote()
    await refresh()
    return note
  }, [refresh])

  const saveNote = useCallback(async (note: WebLiteNote) => {
    await notesRepoWeb.saveNote(note)
    await refresh()
  }, [refresh])

  const deleteNote = useCallback(async (id: string) => {
    await notesRepoWeb.deleteNote(id)
    await refresh()
  }, [refresh])

  return { notes, loading, refresh, createNote, saveNote, deleteNote }
}
