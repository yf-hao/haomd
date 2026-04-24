import { describe, expect, it } from 'vitest'
import { computeDirFromPath, resolveSelectionBaseDirectory } from './selectionBaseDirectory'

describe('selectionBaseDirectory', () => {
  it('returns selected folder path when a directory is selected', () => {
    expect(
      resolveSelectionBaseDirectory({
        selectedFolderPath: '/root/notes',
        currentFilePath: '/root/notes/doc.md',
        fallbackRoot: '/root',
      }),
    ).toBe('/root/notes')
  })

  it('returns sibling directory when a file is selected', () => {
    expect(
      resolveSelectionBaseDirectory({
        selectedFolderPath: null,
        currentFilePath: '/root/notes/doc.md',
        fallbackRoot: '/root',
      }),
    ).toBe('/root/notes')
  })

  it('falls back to first root when neither folder nor file is selected', () => {
    expect(
      resolveSelectionBaseDirectory({
        selectedFolderPath: null,
        currentFilePath: null,
        fallbackRoot: '/root',
      }),
    ).toBe('/root')
  })

  it('preserves windows separators when deriving file parent directory', () => {
    expect(computeDirFromPath('C:\\Users\\yfhao\\Notes\\doc.md')).toBe('C:\\Users\\yfhao\\Notes')
  })
})
