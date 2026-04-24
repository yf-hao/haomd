import { describe, expect, it } from 'vitest'
import { matchCreateDirectoryUnderSelection } from './createDirectoryIntentMatcher'

describe('createDirectoryIntentMatcher', () => {
  it('matches chinese create-directory commands', () => {
    expect(matchCreateDirectoryUnderSelection('创建 demo 目录')).toEqual({
      directoryName: 'demo',
    })
    expect(matchCreateDirectoryUnderSelection('新建 “离散数学” 文件夹')).toEqual({
      directoryName: '离散数学',
    })
    expect(matchCreateDirectoryUnderSelection('创建一个名为dd的目录')).toEqual({
      directoryName: 'dd',
    })
    expect(matchCreateDirectoryUnderSelection('新建一个叫做“章节一”的文件夹')).toEqual({
      directoryName: '章节一',
    })
  })

  it('matches english create-directory commands', () => {
    expect(matchCreateDirectoryUnderSelection('create folder chapter1')).toEqual({
      directoryName: 'chapter1',
    })
    expect(matchCreateDirectoryUnderSelection('create a folder named unit-1')).toEqual({
      directoryName: 'unit-1',
    })
  })

  it('returns null for non-directory commands', () => {
    expect(matchCreateDirectoryUnderSelection('创建 demo.md')).toBeNull()
    expect(matchCreateDirectoryUnderSelection('保存到 demo 目录')).toBeNull()
  })
})
