import { describe, expect, it } from 'vitest'
import {
  matchCreateDirectoryInWorkspace,
  matchDeleteWorkspaceEntry,
  matchRenameWorkspaceEntry,
} from './workspaceEntryIntentMatcher'

describe('workspaceEntryIntentMatcher', () => {
  it('matches create-directory sentence without spaces', () => {
    expect(matchCreateDirectoryInWorkspace('在temp下创建名为“测试”的文件夹')).toEqual({
      parentPath: 'temp',
      directoryName: '测试',
    })
  })

  it('matches delete sentence without spaces', () => {
    expect(matchDeleteWorkspaceEntry('删除temp下的demo文件夹')).toEqual({
      targetPath: 'temp/demo',
      targetKind: 'dir',
    })
  })

  it('matches rename sentence without spaces', () => {
    expect(matchRenameWorkspaceEntry('把temp下的hello.md重命名为hi.md')).toEqual({
      targetPath: 'temp/hello.md',
      newName: 'hi.md',
      targetKind: 'file',
    })
  })
})
