import { expect, it, vi } from 'vitest'
import { moveWorkspaceFile, planOnMainThread } from './moveWorkspaceFile'
import { FileMoveError } from '../ports/fileMovePort'
import { workspaceDocumentOperations } from '../../document/documentOperationCoordinator'

it('replans numbered self links when a concurrent operation takes the proposed name', async () => {
  const prepare = vi.fn().mockResolvedValueOnce({ operationId: '1', oldPath: '/a/n.md', newPath: '/b/n.md',
    documents: [{ path: '/a/n.md', content: '[self](n.md)', hash: 'hash', mtimeMs: 1 }] })
    .mockResolvedValueOnce({ operationId: '2', oldPath: '/a/n.md', newPath: '/b/n01.md',
      documents: [{ path: '/a/n.md', content: '[self](n.md)', hash: 'hash', mtimeMs: 1 }] })
  const outcome = { oldPath: '/a/n.md', newPath: '/b/n01.md', documents: [], reconciliationRequired: false }
  const commit = vi.fn().mockRejectedValueOnce(new FileMoveError('occupied', 'CONFLICT')).mockResolvedValueOnce(outcome)
  const cancel = vi.fn().mockResolvedValue(undefined)
  const apply = vi.fn()
  await moveWorkspaceFile({ sourcePath: '/a/n.md', targetDirectory: '/b' }, {
    files: { prepare, commit, cancel }, operations: workspaceDocumentOperations, plan: planOnMainThread, validateOpenDocuments: () => {}, apply,
  })
  expect(commit.mock.calls[1][1][0].content).toBe('[self](n01.md)')
  expect(prepare).toHaveBeenLastCalledWith('/a/n.md', '/b')
  expect(apply).toHaveBeenCalledExactlyOnceWith(outcome)
  expect(cancel).toHaveBeenCalledTimes(1)
})

it('rejects a plan containing other documents before any analysis or disk commit', async () => {
  const files = {
    prepare: vi.fn().mockResolvedValue({ operationId: 'invalid', oldPath: '/a/n.md', newPath: '/b/n.md', documents: [
      { path: '/a/n.md', content: '[a](image.png)', hash: 'a', mtimeMs: 1 },
      { path: '/index.md', content: '[n](a/n.md)', hash: 'b', mtimeMs: 1 },
    ] }),
    commit: vi.fn(), cancel: vi.fn().mockResolvedValue(undefined),
  }
  const plan = vi.fn()
  await expect(moveWorkspaceFile({ sourcePath: '/a/n.md', targetDirectory: '/b' }, {
    files, operations: workspaceDocumentOperations, plan, validateOpenDocuments: () => {}, apply: () => {},
  })).rejects.toThrow('只能包含被移动文件')
  expect(plan).not.toHaveBeenCalled()
  expect(files.commit).not.toHaveBeenCalled()
  expect(files.cancel).toHaveBeenCalledWith('invalid')
})

it('serializes a queued save after the new path has been committed to the UI', async () => {
  let path = '/old/n.md'
  let complete!: () => void
  const pending = new Promise<void>(resolve => { complete = resolve })
  const first = workspaceDocumentOperations.run(async () => { await pending; path = '/new/n.md' })
  const saved: string[] = []
  const second = workspaceDocumentOperations.run(async () => { saved.push(path) })
  complete()
  await Promise.all([first, second])
  expect(saved).toEqual(['/new/n.md'])
})
