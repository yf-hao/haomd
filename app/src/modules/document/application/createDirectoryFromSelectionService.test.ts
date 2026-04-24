import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDirectoryFromSelection } from './createDirectoryFromSelectionService'
import { createFolder, listFolder } from '../../files/service'

vi.mock('../../files/service', () => ({
  listFolder: vi.fn(),
  createFolder: vi.fn(),
}))

describe('createDirectoryFromSelectionService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a child directory under selected directory', async () => {
    vi.mocked(listFolder).mockResolvedValue({
      ok: true,
      data: [],
      traceId: 't1',
    })
    vi.mocked(createFolder).mockResolvedValue({
      ok: true,
      data: null,
      traceId: 't2',
    })

    const result = await createDirectoryFromSelection(
      { directoryName: 'demo' },
      {
        getBaseDirectory: () => '/root/notes',
      },
    )

    expect(createFolder).toHaveBeenCalledWith('/root/notes/demo')
    expect(result).toEqual({
      ok: true,
      createdDirectoryPath: '/root/notes/demo',
      directoryName: 'demo',
      message: '已创建目录：demo',
    })
  })

  it('creates a sibling directory when base directory comes from selected file parent', async () => {
    vi.mocked(listFolder).mockResolvedValue({
      ok: true,
      data: [],
      traceId: 't1',
    })
    vi.mocked(createFolder).mockResolvedValue({
      ok: true,
      data: null,
      traceId: 't2',
    })

    const result = await createDirectoryFromSelection(
      { directoryName: 'chapter' },
      {
        getBaseDirectory: () => '/root/course',
      },
    )

    expect(createFolder).toHaveBeenCalledWith('/root/course/chapter')
    expect(result).toEqual({
      ok: true,
      createdDirectoryPath: '/root/course/chapter',
      directoryName: 'chapter',
      message: '已创建目录：chapter',
    })
  })

  it('rejects duplicate directory names', async () => {
    vi.mocked(listFolder).mockResolvedValue({
      ok: true,
      data: [{ path: '/root/notes/demo', name: 'demo', kind: 'dir' }],
      traceId: 't3',
    })

    const result = await createDirectoryFromSelection(
      { directoryName: 'demo' },
      {
        getBaseDirectory: () => '/root/notes',
      },
    )

    expect(createFolder).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: false,
      message: '目标目录已存在：demo',
    })
  })
})
