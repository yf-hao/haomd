import { describe, expect, it } from 'vitest'
import { getFilePathIdentity } from './filePathState'

describe('getFilePathIdentity', () => {
  it('normalizes Windows separators and case', () => {
    expect(getFilePathIdentity('C:\\Docs\\Test.md')).toBe('c:/docs/test.md')
    expect(getFilePathIdentity('c:/docs/test.md')).toBe('c:/docs/test.md')
  })

  it('removes Windows extended path prefixes and trailing separators', () => {
    expect(getFilePathIdentity('\\\\?\\C:\\Docs\\Test.md\\')).toBe('c:/docs/test.md')
  })

  it('normalizes UNC path case', () => {
    expect(getFilePathIdentity('\\\\Server\\Share\\Test.md')).toBe('/server/share/test.md')
  })

  it('preserves case for Unix paths', () => {
    expect(getFilePathIdentity('/Users/Hao/Test.md')).toBe('/Users/Hao/Test.md')
  })
})
