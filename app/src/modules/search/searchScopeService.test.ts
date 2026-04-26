import { describe, expect, it } from 'vitest'
import { buildSearchScope } from './searchScopeService'

describe('searchScopeService', () => {
  it('dedupes folder roots and standalone files', () => {
    expect(
      buildSearchScope({
        folderRoots: ['/root', '/root', 'C:\\notes'],
        standaloneFiles: [
          { path: '/root/a.md' },
          { path: '/root/a.md' },
          { path: 'C:\\notes\\b.md' },
        ],
      }),
    ).toEqual({
      folderRoots: ['/root', 'C:/notes'],
      standaloneFiles: ['/root/a.md', 'C:/notes/b.md'],
    })
  })
})
