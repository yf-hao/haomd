import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  executeCreateDirectoryUnderSelection,
  executeCreateDirectoryInWorkspace,
  executeDeleteCurrentDocument,
  executeDeleteCurrentFolder,
  executeDeleteWorkspaceEntry,
  executeRenameCurrentDocument,
  executeRenameWorkspaceEntry,
  executeSaveOrExportCurrentDocument,
} from './documentBuiltinTool'
import { saveOrExportCurrentDocument } from './application/documentSaveExportService'
import { renameCurrentDocument } from './application/documentRenameService'
import { createDirectoryFromSelection } from './application/createDirectoryFromSelectionService'
import { createDirectoryInWorkspace } from './application/createDirectoryInWorkspaceService'
import { renameWorkspaceEntry } from './application/renameWorkspaceEntryService'

vi.mock('./application/documentSaveExportService', () => ({
  saveOrExportCurrentDocument: vi.fn(),
}))

vi.mock('./application/documentRenameService', () => ({
  renameCurrentDocument: vi.fn(),
}))

vi.mock('./application/createDirectoryFromSelectionService', () => ({
  createDirectoryFromSelection: vi.fn(),
}))

vi.mock('./application/createDirectoryInWorkspaceService', () => ({
  createDirectoryInWorkspace: vi.fn(),
}))

vi.mock('./application/renameWorkspaceEntryService', () => ({
  renameWorkspaceEntry: vi.fn(),
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

  it('returns error when deleting without selected folder', async () => {
    const result = await executeDeleteCurrentFolder(
      {},
      {
        getCurrentFolderPath: () => null,
      },
    )

    expect(result).toContain('未选中文件夹')
  })

  it('requests deletion confirmation for current folder', async () => {
    const onRequestDeleteCurrentFolder = vi.fn().mockResolvedValue({
      ok: true,
      message: '已删除：/root/notes',
    })

    const result = await executeDeleteCurrentFolder(
      {},
      {
        getCurrentFolderPath: () => '/root/notes',
        onRequestDeleteCurrentFolder,
      },
    )

    expect(onRequestDeleteCurrentFolder).toHaveBeenCalledWith('/root/notes')
    expect(result).toBe('✅ 已删除：/root/notes')
  })

  it('returns missing fileName for rename tool', async () => {
    const result = await executeRenameCurrentDocument({}, {})

    expect(result).toContain('缺少必要参数')
    expect(renameCurrentDocument).not.toHaveBeenCalled()
  })

  it('formats rename success message', async () => {
    vi.mocked(renameCurrentDocument).mockResolvedValue({
      ok: true,
      oldFilePath: '/root/doc.md',
      renamedPath: '/root/demo.md',
      renamedFileName: 'demo.md',
      message: '已将当前文档重命名为 demo.md',
    })

    const result = await executeRenameCurrentDocument(
      { fileName: 'demo' },
      {
        getCurrentFilePath: () => '/root/doc.md',
      },
    )

    expect(result).toBe('✅ 已将当前文档重命名为 demo.md')
  })

  it('delegates rename to UI callback when provided', async () => {
    const onRenameCurrentDocument = vi.fn().mockResolvedValue({
      ok: true,
      message: '已将当前文档重命名为 demo.md',
    })

    const result = await executeRenameCurrentDocument(
      { fileName: 'demo' },
      {
        onRenameCurrentDocument,
      },
    )

    expect(onRenameCurrentDocument).toHaveBeenCalledWith('demo')
    expect(result).toBe('✅ 已将当前文档重命名为 demo.md')
  })

  it('formats create-directory success message', async () => {
    vi.mocked(createDirectoryFromSelection).mockResolvedValue({
      ok: true,
      createdDirectoryPath: '/root/demo',
      directoryName: 'demo',
      message: '已创建目录：demo',
    })

    const result = await executeCreateDirectoryUnderSelection(
      { directoryName: 'demo' },
      {
        getSelectionBaseDirectory: () => '/root',
      },
    )

    expect(result).toBe('✅ 已创建目录：demo')
  })

  it('delegates create-directory to UI callback when provided', async () => {
    const onCreateDirectoryUnderSelection = vi.fn().mockResolvedValue({
      ok: true,
      message: '已创建目录：demo',
    })

    const result = await executeCreateDirectoryUnderSelection(
      { directoryName: 'demo' },
      {
        onCreateDirectoryUnderSelection,
      },
    )

    expect(onCreateDirectoryUnderSelection).toHaveBeenCalledWith('demo')
    expect(result).toBe('✅ 已创建目录：demo')
  })

  it('delegates workspace-entry delete to UI callback when provided', async () => {
    const onRequestDeleteWorkspaceEntry = vi.fn().mockResolvedValue({
      ok: true,
      message: '请确认是否删除目标「temp/hello.md」。',
    })

    const result = await executeDeleteWorkspaceEntry(
      { targetPath: 'temp/hello.md', targetKind: 'file' },
      { onRequestDeleteWorkspaceEntry },
    )

    expect(onRequestDeleteWorkspaceEntry).toHaveBeenCalledWith('temp/hello.md', 'file')
    expect(result).toBe('✅ 请确认是否删除目标「temp/hello.md」。')
  })

  it('formats workspace-entry rename success message', async () => {
    vi.mocked(renameWorkspaceEntry).mockResolvedValue({
      ok: true,
      oldPath: '/root/temp/hello.md',
      renamedPath: '/root/temp/hi.md',
      renamedName: 'hi.md',
      targetKind: 'file',
      message: '已将文件重命名为 hi.md',
    })

    const result = await executeRenameWorkspaceEntry(
      { targetPath: 'temp/hello.md', newName: 'hi.md', targetKind: 'file' },
      { getWorkspaceRoot: () => '/root' },
    )

    expect(result).toBe('✅ 已将文件重命名为 hi.md')
  })

  it('formats create-directory-in-workspace success message', async () => {
    vi.mocked(createDirectoryInWorkspace).mockResolvedValue({
      ok: true,
      createdDirectoryPath: '/root/temp/demo',
      directoryName: 'demo',
      message: '已创建目录：demo',
    })

    const result = await executeCreateDirectoryInWorkspace(
      { parentPath: 'temp', directoryName: 'demo' },
      { getWorkspaceRoot: () => '/root' },
    )

    expect(result).toBe('✅ 已创建目录：demo')
  })
})
