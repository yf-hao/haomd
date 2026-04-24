import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeDeleteCurrentDocument, executeSaveOrExportCurrentDocument } from './documentBuiltinTool'
import { saveOrExportCurrentDocument } from './application/documentSaveExportService'

vi.mock('./application/documentSaveExportService', () => ({
  saveOrExportCurrentDocument: vi.fn(),
}))

describe('documentBuiltinTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requires targetDirectory for workspace target', async () => {
    const result = await executeSaveOrExportCurrentDocument(
      { format: 'md', target: 'workspace_directory' },
      {
        getCurrentMarkdown: () => '# Doc',
        getCurrentFileName: () => 'doc.md',
      },
    )

    expect(result).toContain('必须提供 targetDirectory')
    expect(saveOrExportCurrentDocument).not.toHaveBeenCalled()
  })

  it('formats success message', async () => {
    vi.mocked(saveOrExportCurrentDocument).mockResolvedValue({
      ok: true,
      savedFilePath: '/root/doc.md',
    })

    const result = await executeSaveOrExportCurrentDocument(
      { format: 'md', target: 'current_file_dir' },
      {
        getCurrentMarkdown: () => '# Doc',
        getCurrentFileName: () => 'doc.md',
      },
    )

    expect(result).toBe('✅ 已保存：/root/doc.md')
  })

  it('formats failure message from service', async () => {
    vi.mocked(saveOrExportCurrentDocument).mockResolvedValue({
      ok: false,
      message: '导出失败。',
    })

    const result = await executeSaveOrExportCurrentDocument(
      { format: 'html', target: 'current_file_dir' },
      {
        getCurrentMarkdown: () => '# Doc',
        getCurrentFileName: () => 'doc.md',
      },
    )

    expect(result).toContain('导出失败')
  })

  it('passes fileName through to service', async () => {
    vi.mocked(saveOrExportCurrentDocument).mockResolvedValue({
      ok: true,
      savedFilePath: '/root/demo.md',
    })

    await executeSaveOrExportCurrentDocument(
      {
        format: 'md',
        target: 'workspace_directory',
        targetDirectory: '网络笔记',
        fileName: 'demo.md',
      },
      {
        getCurrentMarkdown: () => '# Doc',
        getCurrentFileName: () => null,
      },
    )

    expect(saveOrExportCurrentDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'demo.md',
      }),
      expect.any(Object),
    )
  })

  it('notifies onDocumentSaved after success', async () => {
    const onDocumentSaved = vi.fn()
    vi.mocked(saveOrExportCurrentDocument).mockResolvedValue({
      ok: true,
      savedFilePath: '/root/demo.md',
    })

    await executeSaveOrExportCurrentDocument(
      {
        format: 'md',
        target: 'current_file_dir',
      },
      {
        getCurrentMarkdown: () => '# Doc',
        getCurrentFileName: () => 'doc.md',
        onDocumentSaved,
      },
    )

    expect(onDocumentSaved).toHaveBeenCalledWith('/root/demo.md')
  })

  it('returns error when deleting transient current document', async () => {
    const result = await executeDeleteCurrentDocument(
      {},
      {
        getCurrentFilePath: () => 'untitled',
      },
    )

    expect(result).toContain('尚未保存')
  })

  it('requests deletion confirmation for persisted current document', async () => {
    const onRequestDeleteCurrentDocument = vi.fn().mockResolvedValue({
      ok: true,
      message: '已删除：/root/demo.md',
    })

    const result = await executeDeleteCurrentDocument(
      {},
      {
        getCurrentFilePath: () => '/root/demo.md',
        onRequestDeleteCurrentDocument,
      },
    )

    expect(onRequestDeleteCurrentDocument).toHaveBeenCalledWith('/root/demo.md')
    expect(result).toBe('✅ 已删除：/root/demo.md')
  })
})
