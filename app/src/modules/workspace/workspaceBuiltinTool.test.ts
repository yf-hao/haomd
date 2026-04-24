import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockInvoke } from '../../../vitest.setup'
import {
  buildWorkspaceMountedRootsPrompt,
  executeResolveWorkspaceDirectory,
  executeWriteToWorkspace,
} from './workspaceBuiltinTool'
import { setWorkspaceMountedRoots } from './workspaceMountedRoots'

describe('workspaceBuiltinTool', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    setWorkspaceMountedRoots([])
  })

  it('should expose mounted roots summary prompt', () => {
    setWorkspaceMountedRoots(['/tmp/离散数学', '/tmp/高等数学'])
    const prompt = buildWorkspaceMountedRootsPrompt()

    expect(prompt).toContain('离散数学')
    expect(prompt).toContain('高等数学')
    expect(prompt).toContain('write_to_workspace')
  })

  it('should reject when no mounted roots exist', async () => {
    const result = await executeWriteToWorkspace({
      targetDirectory: '离散数学',
      fileName: 'test.md',
      content: '# hi',
    })

    expect(result).toContain('当前文件浏览器没有挂载目录')
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('should format ambiguous backend result', async () => {
    setWorkspaceMountedRoots(['/tmp/离散数学'])
    mockInvoke.mockResolvedValueOnce({
      Ok: {
        data: {
          ok: false,
          reason: 'ambiguous',
          candidates: ['/tmp/离散数学/教案', '/tmp/高等数学/教案'],
        },
        trace_id: 'trace-1',
      },
    })

    const result = await executeWriteToWorkspace({
      targetDirectory: '教案',
      fileName: 'test.md',
      content: '# hi',
    })

    expect(result).toContain('目录名存在歧义')
    expect(result).toContain('/tmp/离散数学/教案')
  })

  it('should notify onDocumentSaved after workspace file is written', async () => {
    setWorkspaceMountedRoots(['/tmp/离散数学'])
    mockInvoke.mockResolvedValueOnce({
      Ok: {
        data: {
          ok: true,
          savedFilePath: '/tmp/离散数学/测试/test.md',
        },
        trace_id: 'trace-3',
      },
    })

    const onDocumentSaved = vi.fn()
    const result = await executeWriteToWorkspace(
      {
        targetDirectory: '测试',
        fileName: 'test.md',
        content: '你好',
      },
      { onDocumentSaved },
    )

    expect(result).toContain('/tmp/离散数学/测试/test.md')
    expect(onDocumentSaved).toHaveBeenCalledWith('/tmp/离散数学/测试/test.md')
  })

  it('should notify status bar after workspace file is written', async () => {
    setWorkspaceMountedRoots(['/tmp/离散数学'])
    mockInvoke.mockResolvedValueOnce({
      Ok: {
        data: {
          ok: true,
          savedFilePath: '/tmp/离散数学/测试/t2.md',
        },
        trace_id: 'trace-5',
      },
    })

    const setStatusMessage = vi.fn()
    const result = await executeWriteToWorkspace(
      {
        targetDirectory: '测试',
        fileName: 't2.md',
        content: '你好',
      },
      { setStatusMessage },
    )

    expect(result).toContain('/tmp/离散数学/测试/t2.md')
    expect(setStatusMessage).toHaveBeenCalledWith('✅ 已保存：/tmp/离散数学/测试/t2.md')
  })

  it('should allow creating an empty file in workspace', async () => {
    setWorkspaceMountedRoots(['/tmp/离散数学'])
    mockInvoke.mockResolvedValueOnce({
      Ok: {
        data: {
          ok: true,
          savedFilePath: '/tmp/离散数学/测试/t1.md',
        },
        trace_id: 'trace-4',
      },
    })

    const result = await executeWriteToWorkspace({
      targetDirectory: '测试',
      fileName: 't1.md',
      content: '',
    })

    expect(result).toContain('/tmp/离散数学/测试/t1.md')
    expect(mockInvoke).toHaveBeenCalledWith('write_workspace_file', {
      mountedRoots: ['/tmp/离散数学'],
      targetDirectory: '测试',
      fileName: 't1.md',
      content: '',
    })
  })

  it('should format resolved directory result', async () => {
    setWorkspaceMountedRoots(['/tmp/离散数学'])
    mockInvoke.mockResolvedValueOnce({
      Ok: {
        data: {
          ok: true,
          resolvedDirectory: '/tmp/离散数学/教案',
        },
        trace_id: 'trace-2',
      },
    })

    const result = await executeResolveWorkspaceDirectory({
      targetDirectory: '离散数学/教案',
    })

    expect(result).toContain('已解析目标目录')
    expect(result).toContain('/tmp/离散数学/教案')
  })
})
