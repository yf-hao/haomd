import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BackendError, BackendResult } from '../platform/backendTypes'
import type { RecentFile } from './types'
import {
  readFile,
  writeFile,
  writeFileNoRecent,
  listRecentPage,
  logRecentFile,
  clearRecentRemote,
  deleteRecentRemote,
  listFolder,
  deleteFsEntry,
  createFolder,
  mergeRecent,
} from './service'

import { mapCodeForTest, normalizeInvokeErrorForTest } from './serviceTestHelpers'
import { mockInvoke } from '../../../vitest.setup'
import { isTauriEnv } from '../platform/runtime'

// 为了避免破坏 service.ts 的封装，这里主要通过公开 API + 全局 mock 来覆盖内部逻辑

vi.mock('../platform/runtime', () => ({
  isTauriEnv: vi.fn(),
}))

const ok = <T>(data: T): BackendResult<T> => ({ Ok: { data, trace_id: 'trace-backend' } })
const err = (error: BackendError): BackendResult<never> => ({ Err: { error } })

const tauriOff = () => {
  ;(isTauriEnv as unknown as { mockReturnValue: (v: boolean) => void }).mockReturnValue(false)
}

const tauriOn = () => {
  ;(isTauriEnv as unknown as { mockReturnValue: (v: boolean) => void }).mockReturnValue(true)
}

describe('files/service helpers', () => {
  it('mapCodeForTest should map backend codes to domain codes', () => {
    expect(mapCodeForTest('OK')).toBe('OK')
    expect(mapCodeForTest('NotFound')).toBe('NOT_FOUND')
    expect(mapCodeForTest('IoError')).toBe('IO_ERROR')
    expect(mapCodeForTest('TooLarge')).toBe('TOO_LARGE')
    expect(mapCodeForTest('UNKNOWN')).toBe('UNKNOWN')
  })

  it('normalizeInvokeErrorForTest should map unknown error to UNKNOWN code with message', () => {
    const result = normalizeInvokeErrorForTest(new Error('boom'))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('UNKNOWN')
      expect(result.error.message).toContain('boom')
    }
  })

  it('normalizeInvokeErrorForTest should respect BackendError-like code', () => {
    const error = { message: 'io fail', code: 'IoError' } as BackendError & { message: string }
    const result = normalizeInvokeErrorForTest(error)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('IO_ERROR')
      expect(result.error.message).toContain('io fail')
    }
  })

  it('mergeRecent should deduplicate by path, sort by lastOpenedAt, and respect limit', () => {
    const base: RecentFile[] = [
      {
        path: '/a.md',
        displayName: 'a',
        lastOpenedAt: 1,
        isFolder: false,
      },
      {
        path: '/b.md',
        displayName: 'b',
        lastOpenedAt: 2,
        isFolder: false,
      },
    ]

    const entry: RecentFile = {
      path: '/a.md',
      displayName: 'a (new)',
      lastOpenedAt: 3,
      isFolder: false,
    }

    const merged = mergeRecent(base, entry, 3)
    expect(merged).toHaveLength(2)
    // 新 entry 在最前
    expect(merged[0].path).toBe('/a.md')
    expect(merged[0].lastOpenedAt).toBe(3)
    // b 保持存在
    expect(merged[1].path).toBe('/b.md')
  })
})

describe('files/service API', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    tauriOn()
  })

  it('readFile should return notAvailable when Tauri is not available', async () => {
    tauriOff()

    const result = await readFile('/foo.md', 'trace-not-tauri')

    expect(mockInvoke).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('UNKNOWN')
      expect(result.error.message).toBe('Tauri 后端不可用')
      expect(result.error.traceId).toBe('trace-not-tauri')
    }
  })

  it('readFile should map backend file and propagate trace id on success', async () => {
    const backendFile = {
      path: '/foo.md',
      content: 'hello',
      encoding: 'utf-8',
      mtime_ms: 123,
      hash: 'hash-1',
    }
    mockInvoke.mockResolvedValueOnce(ok(backendFile))

    const result = await readFile('/foo.md', 'trace-read')

    expect(mockInvoke).toHaveBeenCalledWith('read_file', { path: '/foo.md', trace_id: 'trace-read' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({
        path: '/foo.md',
        content: 'hello',
        encoding: 'utf-8',
        mtimeMs: 123,
        hash: 'hash-1',
      })
      expect(result.traceId).toBe('trace-backend')
    }
  })

  it('readFile should normalize invoke error using backend-like error object', async () => {
    mockInvoke.mockRejectedValueOnce({ message: 'io fail', code: 'IoError' })

    const result = await readFile('/foo.md', 'trace-err')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('IO_ERROR')
      expect(result.error.message).toContain('io fail')
      expect(result.error.traceId).toBe('trace-err')
    }
  })

  it('writeFile should map write result when backend code is OK', async () => {
    const backendWrite = {
      path: '/foo.md',
      mtime_ms: 456,
      hash: 'hash-2',
      code: 'OK' as const,
      message: 'ignored',
    }
    mockInvoke.mockResolvedValueOnce(ok(backendWrite))

    const result = await writeFile({ path: '/foo.md', content: 'data', traceId: 'trace-write' })

    expect(mockInvoke).toHaveBeenCalledWith('write_file', {
      path: '/foo.md',
      content: 'data',
      expected_mtime: undefined,
      expected_hash: undefined,
      trace_id: 'trace-write',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({
        path: '/foo.md',
        mtimeMs: 456,
        hash: 'hash-2',
        code: 'OK',
        message: undefined,
      })
    }
  })

  it('writeFile should map non-OK backend write result into error using mapCode', async () => {
    const backendWrite = {
      path: '/foo.md',
      mtime_ms: 456,
      hash: 'hash-2',
      code: 'TooLarge' as const,
      message: 'too big',
    }
    mockInvoke.mockResolvedValueOnce(ok(backendWrite))

    const result = await writeFile({ path: '/foo.md', content: 'data', traceId: 'trace-write-err' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('TOO_LARGE')
      expect(result.error.message).toBe('too big')
    }
  })

  it('writeFile should map backend Err using toError', async () => {
    const backendError: BackendError = {
      code: 'NotFound',
      message: 'missing',
      trace_id: 'trace-back',
    }
    mockInvoke.mockResolvedValueOnce(err(backendError))

    const result = await writeFile({ path: '/missing.md', content: 'x', traceId: 'trace-write-miss' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND')
      expect(result.error.message).toBe('missing')
      // 使用 error.trace_id 优先
      expect(result.error.traceId).toBe('trace-back')
    }
  })

  it('writeFileNoRecent should call write_file_no_recent and map result', async () => {
    const backendWrite = {
      path: '/foo.md',
      mtime_ms: 789,
      hash: 'hash-3',
      code: 'OK' as const,
      message: undefined,
    }
    mockInvoke.mockResolvedValueOnce(ok(backendWrite))

    const result = await writeFileNoRecent({ path: '/foo.md', content: 'data', traceId: 'trace-no-recent' })

    expect(mockInvoke).toHaveBeenCalledWith('write_file_no_recent', {
      path: '/foo.md',
      content: 'data',
      expected_mtime: undefined,
      expected_hash: undefined,
      trace_id: 'trace-no-recent',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.path).toBe('/foo.md')
    }
  })

  it('listRecentPage should map backend recent list', async () => {
    const backendList = [
      {
        path: '/a.md',
        display_name: 'A',
        last_opened_at: 1,
        is_folder: false,
      },
    ]
    mockInvoke.mockResolvedValueOnce(ok(backendList))

    const result = await listRecentPage(0, 10, 'trace-recent')

    expect(mockInvoke).toHaveBeenCalledWith('list_recent', {
      offset: 0,
      limit: 10,
      trace_id: 'trace-recent',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual([
        {
          path: '/a.md',
          displayName: 'A',
          lastOpenedAt: 1,
          isFolder: false,
        },
      ])
    }
  })

  it('logRecentFile / clearRecentRemote / deleteRecentRemote should map Ok and Err results', async () => {
    // logRecentFile Ok
    mockInvoke.mockResolvedValueOnce(ok<unknown>(null))
    const logOk = await logRecentFile('/a.md', false, 'trace-log')
    expect(mockInvoke).toHaveBeenCalledWith('log_recent_file', {
      path: '/a.md',
      isFolder: false,
      trace_id: 'trace-log',
    })
    expect(logOk.ok).toBe(true)

    // clearRecentRemote Err
    const clearErr: BackendError = { code: 'CANCELLED', message: 'cancel', trace_id: 'trace-clear' }
    mockInvoke.mockResolvedValueOnce(err(clearErr))
    const clear = await clearRecentRemote('trace-clear-front')
    expect(clear.ok).toBe(false)
    if (!clear.ok) {
      expect(clear.error.code).toBe('CANCELLED')
      expect(clear.error.message).toBe('cancel')
    }

    // deleteRecentRemote Ok
    mockInvoke.mockResolvedValueOnce(ok<unknown>(null))
    const del = await deleteRecentRemote('/a.md', 'trace-del')
    expect(mockInvoke).toHaveBeenCalledWith('delete_recent_entry', { path: '/a.md', trace_id: 'trace-del' })
    expect(del.ok).toBe(true)
  })

  it('listFolder / deleteFsEntry / createFolder should map success and propagate errors via normalizeInvokeError', async () => {
    const backendEntries = [
      { path: '/dir', name: 'dir', kind: 'dir' as const },
      { path: '/file.md', name: 'file.md', kind: 'file' as const },
    ]

    // listFolder success
    mockInvoke.mockResolvedValueOnce(ok(backendEntries))
    const listRes = await listFolder('/root', 'trace-folder')
    expect(mockInvoke).toHaveBeenCalledWith('list_folder', { path: '/root', trace_id: 'trace-folder' })
    expect(listRes.ok).toBe(true)
    if (listRes.ok) {
      expect(listRes.data).toEqual([
        { path: '/dir', name: 'dir', kind: 'dir' },
        { path: '/file.md', name: 'file.md', kind: 'file' },
      ])
    }

    // deleteFsEntry invoke 抛出普通 Error，触发 normalizeInvokeError 的 UNKNOWN 分支
    mockInvoke.mockRejectedValueOnce(new Error('boom'))
    const delRes = await deleteFsEntry('/file.md', 'trace-del-fs')
    expect(delRes.ok).toBe(false)
    if (!delRes.ok) {
      expect(delRes.error.code).toBe('UNKNOWN')
      expect(delRes.error.message).toContain('boom')
      expect(delRes.error.traceId).toBe('trace-del-fs')
    }

    // createFolder invoke 抛出带 code 的对象，触发 normalizeInvokeError + mapCode
    mockInvoke.mockRejectedValueOnce({ message: 'not allowed', code: 'UNSUPPORTED' })
    const createRes = await createFolder('/nope', 'trace-create')
    expect(createRes.ok).toBe(false)
    if (!createRes.ok) {
      expect(createRes.error.code).toBe('UNSUPPORTED')
      expect(createRes.error.message).toContain('not allowed')
    }
  })
})
