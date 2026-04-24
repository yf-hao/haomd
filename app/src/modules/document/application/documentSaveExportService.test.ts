import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockInvoke } from '../../../../vitest.setup'
import { setActiveWorkspaceDirectory } from '../../workspace/workspaceActiveDirectory'
import { setWorkspaceMountedRoots } from '../../workspace/workspaceMountedRoots'
import { saveOrExportCurrentDocument } from './documentSaveExportService'
import { writeFileNoRecent } from '../../files/service'
import { exportToWordAtPath } from '../../export/word'
import { exportToHtmlAtPath } from '../../export/html'

vi.mock('@tauri-apps/api/path', () => ({
  dirname: vi.fn(async (path: string) => path.replace(/\/[^/]+$/, '')),
  documentDir: vi.fn(async () => '/documents'),
}))

vi.mock('../../files/service', () => ({
  writeFileNoRecent: vi.fn(),
}))

vi.mock('../../export/word', () => ({
  buildWordExportBaseName: vi.fn((fileName: string | null) =>
    (fileName || 'Document').replace(/\.[^./\\]+$/i, '') || 'Document',
  ),
  exportToWordAtPath: vi.fn(),
}))

vi.mock('../../export/html', () => ({
  exportToHtmlAtPath: vi.fn(),
}))

describe('documentSaveExportService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setWorkspaceMountedRoots([])
    setActiveWorkspaceDirectory(null)
  })

  it('saves markdown to current file directory', async () => {
    vi.mocked(writeFileNoRecent).mockResolvedValue({
      ok: true,
      data: { path: '/root/doc.md', mtimeMs: 1, hash: 'h', code: 'OK', message: undefined },
    })

    const result = await saveOrExportCurrentDocument(
      { format: 'md', target: 'current_file_dir' },
      {
        getCurrentMarkdown: () => '# Title',
        getCurrentFileName: () => 'doc.md',
        getCurrentFilePath: () => '/root/doc.md',
      },
    )

    expect(result).toEqual({ ok: true, savedFilePath: '/root/doc.md' })
    expect(writeFileNoRecent).toHaveBeenCalledWith({
      path: '/root/doc.md',
      content: '# Title',
    })
  })

  it('prefers active workspace directory for unsaved current_file_dir saves', async () => {
    setActiveWorkspaceDirectory('/active-dir')
    vi.mocked(exportToWordAtPath).mockResolvedValue(true)

    const result = await saveOrExportCurrentDocument(
      { format: 'word', target: 'current_file_dir' },
      {
        getCurrentMarkdown: () => '# Title',
        getCurrentFileName: () => null,
        getCurrentFilePath: () => null,
        setStatusMessage: vi.fn(),
      },
    )

    expect(result).toEqual({
      ok: true,
      savedFilePath: '/active-dir/Document.docx',
    })
    expect(exportToWordAtPath).toHaveBeenCalledWith(expect.any(Object), '/active-dir/Document.docx')
  })

  it('falls back to documentDir when there is no active workspace directory', async () => {
    vi.mocked(exportToWordAtPath).mockResolvedValue(true)

    const result = await saveOrExportCurrentDocument(
      { format: 'word', target: 'current_file_dir' },
      {
        getCurrentMarkdown: () => '# Title',
        getCurrentFileName: () => null,
        getCurrentFilePath: () => null,
        setStatusMessage: vi.fn(),
      },
    )

    expect(result).toEqual({
      ok: true,
      savedFilePath: '/documents/Document.docx',
    })
    expect(exportToWordAtPath).toHaveBeenCalledWith(expect.any(Object), '/documents/Document.docx')
  })

  it('treats untitled as unsaved and falls back to active workspace directory', async () => {
    setActiveWorkspaceDirectory('/network-notes')
    vi.mocked(writeFileNoRecent).mockResolvedValue({
      ok: true,
      data: {
        path: '/network-notes/de.md',
        mtimeMs: 1,
        hash: 'h',
        code: 'OK',
        message: undefined,
      },
    })

    const result = await saveOrExportCurrentDocument(
      {
        format: 'md',
        target: 'current_file_dir',
        fileName: 'de',
      },
      {
        getCurrentMarkdown: () => '# Title',
        getCurrentFileName: () => 'untitled',
        getCurrentFilePath: () => 'untitled',
      },
    )

    expect(result).toEqual({
      ok: true,
      savedFilePath: '/network-notes/de.md',
    })
    expect(writeFileNoRecent).toHaveBeenCalledWith({
      path: '/network-notes/de.md',
      content: '# Title',
    })
  })

  it('exports word to existing workspace directory', async () => {
    setWorkspaceMountedRoots(['/root'])
    mockInvoke.mockResolvedValueOnce({
      Ok: {
        data: {
          ok: true,
          resolvedDirectory: '/root/网络笔记',
        },
        trace_id: 't1',
      },
    })
    vi.mocked(exportToWordAtPath).mockResolvedValue(true)

    const result = await saveOrExportCurrentDocument(
      { format: 'word', target: 'workspace_directory', targetDirectory: '网络笔记' },
      {
        getCurrentMarkdown: () => '# Title',
        getCurrentFileName: () => 'doc.md',
        getCurrentFilePath: () => '/root/notes/doc.md',
        setStatusMessage: vi.fn(),
      },
    )

    expect(result).toEqual({ ok: true, savedFilePath: '/root/网络笔记/doc.docx' })
    expect(exportToWordAtPath).toHaveBeenCalledWith(
      expect.objectContaining({
        getCurrentMarkdown: expect.any(Function),
        getCurrentFileName: expect.any(Function),
        getFilePath: expect.any(Function),
      }),
      '/root/网络笔记/doc.docx',
    )
  })

  it('creates nested workspace directory under sole mounted root when target is missing', async () => {
    setWorkspaceMountedRoots(['/root'])
    mockInvoke
      .mockResolvedValueOnce({
        Ok: {
          data: {
            ok: false,
            reason: 'not_found',
          },
          trace_id: 't2',
        },
      })
      .mockResolvedValueOnce({
        Ok: {
          data: {
            ok: true,
            resolvedParentDirectory: '/root',
            createdDirectoryPath: '/root/离散数学',
          },
          trace_id: 't3',
        },
      })
      .mockResolvedValueOnce({
        Ok: {
          data: {
            ok: true,
            resolvedParentDirectory: '/root/离散数学',
            createdDirectoryPath: '/root/离散数学/教案',
          },
          trace_id: 't4',
        },
      })
    vi.mocked(writeFileNoRecent).mockResolvedValue({
      ok: true,
      data: {
        path: '/root/离散数学/教案/Document.md',
        mtimeMs: 1,
        hash: 'h',
        code: 'OK',
        message: undefined,
      },
    })

    const result = await saveOrExportCurrentDocument(
      { format: 'md', target: 'workspace_directory', targetDirectory: '离散数学/教案' },
      {
        getCurrentMarkdown: () => '# New',
        getCurrentFileName: () => null,
        getCurrentFilePath: () => null,
      },
    )

    expect(result).toEqual({
      ok: true,
      savedFilePath: '/root/离散数学/教案/Document.md',
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'create_workspace_directory', {
      mountedRoots: ['/root'],
      parentDirectory: '/root',
      directoryName: '离散数学',
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(3, 'create_workspace_directory', {
      mountedRoots: ['/root'],
      parentDirectory: '/root/离散数学',
      directoryName: '教案',
    })
  })

  it('exports html to current file directory', async () => {
    vi.mocked(exportToHtmlAtPath).mockResolvedValue(true)

    const result = await saveOrExportCurrentDocument(
      { format: 'html', target: 'current_file_dir' },
      {
        getCurrentMarkdown: () => '# Title',
        getCurrentFileName: () => 'doc.md',
        getCurrentFilePath: () => '/root/doc.md',
        setStatusMessage: vi.fn(),
      },
    )

    expect(result).toEqual({ ok: true, savedFilePath: '/root/doc.html' })
    expect(exportToHtmlAtPath).toHaveBeenCalledWith(
      expect.objectContaining({
        getCurrentMarkdown: expect.any(Function),
        getCurrentFileName: expect.any(Function),
      }),
      '/root/doc.html',
    )
  })

  it('uses user provided markdown file name for unsaved document in workspace directory', async () => {
    setWorkspaceMountedRoots(['/root'])
    mockInvoke
      .mockResolvedValueOnce({
        Ok: {
          data: {
            ok: false,
            reason: 'not_found',
          },
          trace_id: 't5',
        },
      })
      .mockResolvedValueOnce({
        Ok: {
          data: {
            ok: true,
            resolvedParentDirectory: '/root',
            createdDirectoryPath: '/root/网络笔记',
          },
          trace_id: 't6',
        },
      })
    vi.mocked(writeFileNoRecent).mockResolvedValue({
      ok: true,
      data: {
        path: '/root/网络笔记/demo.md',
        mtimeMs: 1,
        hash: 'h',
        code: 'OK',
        message: undefined,
      },
    })

    const result = await saveOrExportCurrentDocument(
      {
        format: 'md',
        target: 'workspace_directory',
        targetDirectory: '网络笔记',
        fileName: 'demo.md',
      },
      {
        getCurrentMarkdown: () => '# Demo',
        getCurrentFileName: () => null,
        getCurrentFilePath: () => null,
      },
    )

    expect(result).toEqual({
      ok: true,
      savedFilePath: '/root/网络笔记/demo.md',
    })
  })

  it('normalizes requested word file extension to docx', async () => {
    vi.mocked(exportToWordAtPath).mockResolvedValue(true)

    const result = await saveOrExportCurrentDocument(
      {
        format: 'word',
        target: 'current_file_dir',
        fileName: 'demo.md',
      },
      {
        getCurrentMarkdown: () => '# Title',
        getCurrentFileName: () => 'doc.md',
        getCurrentFilePath: () => '/root/doc.md',
        setStatusMessage: vi.fn(),
      },
    )

    expect(result).toEqual({ ok: true, savedFilePath: '/root/demo.docx' })
    expect(exportToWordAtPath).toHaveBeenCalledWith(expect.any(Object), '/root/demo.docx')
  })

  it('rejects fileName with directory separators', async () => {
    const result = await saveOrExportCurrentDocument(
      {
        format: 'md',
        target: 'workspace_directory',
        targetDirectory: '网络笔记',
        fileName: '离散数学/demo.md',
      },
      {
        getCurrentMarkdown: () => '# Demo',
        getCurrentFileName: () => null,
        getCurrentFilePath: () => null,
      },
    )

    expect(result).toEqual({
      ok: false,
      message: 'fileName 只能是文件名，不能包含目录分隔符。目录请通过 targetDirectory 指定。',
    })
  })

  it('maps readonly write failures to a user facing message', async () => {
    vi.mocked(writeFileNoRecent).mockResolvedValue({
      ok: false,
      error: {
        code: 'IO_ERROR',
        message: '当前文件所在目录为只读，无法写入 dde.md。',
      },
    } as any)

    const result = await saveOrExportCurrentDocument(
      {
        format: 'md',
        target: 'current_file_dir',
        fileName: 'dde',
      },
      {
        getCurrentMarkdown: () => '# Demo',
        getCurrentFileName: () => 'untitled',
        getCurrentFilePath: () => 'untitled',
      },
    )

    expect(result).toEqual({
      ok: false,
      message: '目标目录不可写，无法保存到：/documents/dde.md',
    })
  })

  it('aborts before writing when stop was requested', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      saveOrExportCurrentDocument(
        {
          format: 'md',
          target: 'current_file_dir',
          fileName: 'demo',
        },
        {
          getCurrentMarkdown: () => '# Demo',
          getCurrentFileName: () => 'doc.md',
          getCurrentFilePath: () => '/root/doc.md',
          signal: controller.signal,
        },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(writeFileNoRecent).not.toHaveBeenCalled()
  })
})
