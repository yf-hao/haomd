import { describe, it, expect, beforeEach } from 'vitest'
import { listPdfRecent, logPdfRecent, deletePdfRecent, loadPdfFolders, savePdfFolders, updatePdfRecentFolder, type PdfFolder } from './pdfRecentService'
import { mockInvoke } from '../../../vitest.setup'
import type { BackendResult } from '../platform/backendTypes'

interface BackendPdfRecentEntry {
  path: string
  display_name: string
  last_opened_at: number
  folder_id?: string | null
}

const ok = <T>(data: T): BackendResult<T> => ({ Ok: { data, trace_id: 'trace-backend' } })
const err = <T = never>(message: string, code = 'IoError'): BackendResult<T> => ({
  Err: {
    error: {
      code: code as any,
      message,
      trace_id: 'trace-backend-err',
    },
  },
})

describe('pdf/pdfRecentService', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
  })

  it('listPdfRecent should map backend entries to RecentFile shape including folderId', async () => {
    const backendList: BackendPdfRecentEntry[] = [
      {
        path: '/a.pdf',
        display_name: 'a.pdf',
        last_opened_at: 123,
        folder_id: null,
      },
      {
        path: '/b.pdf',
        display_name: 'b.pdf',
        last_opened_at: 456,
        folder_id: 'folder-1',
      },
    ]

    mockInvoke.mockResolvedValueOnce(ok(backendList))

    const result = await listPdfRecent()

    expect(mockInvoke).toHaveBeenCalledWith('list_pdf_recent', {})
    expect(result).toEqual([
      {
        path: '/a.pdf',
        displayName: 'a.pdf',
        lastOpenedAt: 123,
        isFolder: false,
        folderId: undefined,
      },
      {
        path: '/b.pdf',
        displayName: 'b.pdf',
        lastOpenedAt: 456,
        isFolder: false,
        folderId: 'folder-1',
      },
    ])
  })

  it('listPdfRecent should pass limit when provided', async () => {
    const backendList: BackendPdfRecentEntry[] = []
    mockInvoke.mockResolvedValueOnce(ok(backendList))

    const result = await listPdfRecent(5)

    expect(mockInvoke).toHaveBeenCalledWith('list_pdf_recent', { limit: 5 })
    expect(result).toEqual([])
  })

  it('listPdfRecent should throw when backend returns Err', async () => {
    mockInvoke.mockResolvedValueOnce(err('load failed'))

    await expect(listPdfRecent()).rejects.toThrow('load failed')
  })

  it('logPdfRecent should call log_pdf_recent_file with path', async () => {
    mockInvoke.mockResolvedValueOnce(ok<unknown>(null))

    await logPdfRecent('/b.pdf')

    expect(mockInvoke).toHaveBeenCalledWith('log_pdf_recent_file', { path: '/b.pdf' })
  })

  it('deletePdfRecent should call delete_pdf_recent_entry with path', async () => {
    mockInvoke.mockResolvedValueOnce(ok<unknown>(null))

    await deletePdfRecent('/c.pdf')

    expect(mockInvoke).toHaveBeenCalledWith('delete_pdf_recent_entry', { path: '/c.pdf' })
  })

  it('loadPdfFolders should sort folders by name and return list', async () => {
    const backendFolders: PdfFolder[] = [
      { id: '2', name: 'Z folder' },
      { id: '1', name: 'A folder' },
    ]

    mockInvoke.mockResolvedValueOnce(ok(backendFolders))

    const result = await loadPdfFolders()

    expect(mockInvoke).toHaveBeenCalledWith('load_pdf_folders', {})
    expect(result).toEqual([
      { id: '1', name: 'A folder' },
      { id: '2', name: 'Z folder' },
    ])
  })

  it('loadPdfFolders should throw when backend returns Err', async () => {
    mockInvoke.mockResolvedValueOnce(err('load folders failed'))

    await expect(loadPdfFolders()).rejects.toThrow('load folders failed')
  })

  it('savePdfFolders should call save_pdf_folders with folders payload', async () => {
    const folders: PdfFolder[] = [
      { id: '1', name: 'Folder 1' },
    ]

    mockInvoke.mockResolvedValueOnce(ok<unknown>(null))

    await savePdfFolders(folders)

    expect(mockInvoke).toHaveBeenCalledWith('save_pdf_folders', { folders })
  })

  it('updatePdfRecentFolder should call update_pdf_recent_folder with folder id', async () => {
    mockInvoke.mockResolvedValueOnce(ok<unknown>(null))

    await updatePdfRecentFolder('/d.pdf', 'folder-1')

    expect(mockInvoke).toHaveBeenCalledWith('update_pdf_recent_folder', {
      path: '/d.pdf',
      folder_id: 'folder-1',
    })
  })

  it('updatePdfRecentFolder should call update_pdf_recent_folder with null to move back to root', async () => {
    mockInvoke.mockResolvedValueOnce(ok<unknown>(null))

    await updatePdfRecentFolder('/e.pdf', null)

    expect(mockInvoke).toHaveBeenCalledWith('update_pdf_recent_folder', {
      path: '/e.pdf',
      folder_id: null,
    })
  })
})

