import { describe, it, expect, beforeEach } from 'vitest'
import { listPdfRecent, logPdfRecent, deletePdfRecent } from './pdfRecentService'
import { mockInvoke } from '../../../vitest.setup'
import type { BackendResult } from '../platform/backendTypes'

interface BackendPdfRecentEntry {
  path: string
  display_name: string
  last_opened_at: number
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

  it('listPdfRecent should map backend entries to RecentFile shape', async () => {
    const backendList: BackendPdfRecentEntry[] = [
      {
        path: '/a.pdf',
        display_name: 'a.pdf',
        last_opened_at: 123,
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
})
