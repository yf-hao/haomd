import { describe, expect, it } from 'vitest'
import { buildWordExportBaseName } from './index'

describe('export/word - file name handling', () => {
  it('should strip the last file extension for the default docx name', () => {
    expect(buildWordExportBaseName('选择题-7.txt')).toBe('选择题-7')
    expect(buildWordExportBaseName('notes.md')).toBe('notes')
    expect(buildWordExportBaseName('archive.tar.md')).toBe('archive.tar')
  })

  it('should fallback to Document for empty names', () => {
    expect(buildWordExportBaseName(null)).toBe('Document')
    expect(buildWordExportBaseName('')).toBe('Document')
    expect(buildWordExportBaseName('   ')).toBe('Document')
  })
})
