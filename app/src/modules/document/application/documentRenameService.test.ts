import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renameCurrentDocument } from './documentRenameService'
import { listFolder, renameFsEntry } from '../../files/service'

vi.mock('../../files/service', () => ({
  listFolder: vi.fn(),
  renameFsEntry: vi.fn(),
}))

describe('documentRenameService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects transient current document', async () => {
    const result = await renameCurrentDocument(
      { fileName: 'demo' },
      {
        getCurrentFilePath: () => 'untitled',
      },
    )

    expect(result).toEqual({
      ok: false,
      message: '当前文档尚未保存，无法重命名文件。',
    })
  })

  it('appends current extension when omitted', async () => {
    vi.mocked(listFolder).mockResolvedValue({
      ok: true,
      data: [{ path: '/root/doc.md', name: 'doc.md', kind: 'file' }],
      traceId: 't0',
    })
    vi.mocked(renameFsEntry).mockResolvedValue({
      ok: true,
      data: null,
      traceId: 't1',
    })

    const result = await renameCurrentDocument(
      { fileName: 'demo' },
      {
        getCurrentFilePath: () => '/root/doc.md',
      },
    )

    expect(renameFsEntry).toHaveBeenCalledWith('/root/doc.md', '/root/demo.md')
    expect(result).toEqual({
      ok: true,
      oldFilePath: '/root/doc.md',
      renamedPath: '/root/demo.md',
      renamedFileName: 'demo.md',
      message: '已将当前文档重命名为 demo.md',
    })
  })

  it('keeps explicit extension from requested file name', async () => {
    vi.mocked(listFolder).mockResolvedValue({
      ok: true,
      data: [{ path: '/root/doc.md', name: 'doc.md', kind: 'file' }],
      traceId: 't0',
    })
    vi.mocked(renameFsEntry).mockResolvedValue({
      ok: true,
      data: null,
      traceId: 't2',
    })

    const result = await renameCurrentDocument(
      { fileName: 'chapter1.txt' },
      {
        getCurrentFilePath: () => '/root/doc.md',
      },
    )

    expect(renameFsEntry).toHaveBeenCalledWith('/root/doc.md', '/root/chapter1.txt')
    expect(result).toEqual({
      ok: true,
      oldFilePath: '/root/doc.md',
      renamedPath: '/root/chapter1.txt',
      renamedFileName: 'chapter1.txt',
      message: '已将当前文档重命名为 chapter1.txt',
    })
  })

  it('rejects path separators in file name', async () => {
    const result = await renameCurrentDocument(
      { fileName: 'foo/bar' },
      {
        getCurrentFilePath: () => '/root/doc.md',
      },
    )

    expect(result).toEqual({
      ok: false,
      message: '新文件名只能是文件名，不能包含路径。',
    })
  })

  it('rejects rename when target file already exists', async () => {
    vi.mocked(listFolder).mockResolvedValue({
      ok: true,
      data: [
        { path: '/root/doc.md', name: 'doc.md', kind: 'file' },
        { path: '/root/demo.md', name: 'demo.md', kind: 'file' },
      ],
      traceId: 't3',
    })

    const result = await renameCurrentDocument(
      { fileName: 'demo' },
      {
        getCurrentFilePath: () => '/root/doc.md',
      },
    )

    expect(renameFsEntry).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: false,
      message: '目标文件已存在：demo.md',
    })
  })
})
