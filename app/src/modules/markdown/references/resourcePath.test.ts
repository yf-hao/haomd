import { expect, it } from 'vitest'
import { resolveDocumentMedia } from '../../images/resolveDocumentMedia'
import { fileUrl, resolveDocumentLink, resolveLocalResource } from './resourcePath'

it('decodes each resource once for preview and preserves query/hash', () => {
  const path = '/资料/archive/note.md'
  expect(resolveLocalResource('../images/a%20b%23%25.png?size=2#part', path)).toEqual({
    path: '/资料/images/a b#%.png', search: '?size=2', hash: '#part',
  })
  expect(resolveDocumentMedia('../images/a%20b.png', path)).toBe('asset:///资料/images/a b.png')
  expect(resolveDocumentLink('../notes/a%20b.md#part', path)).toBe('file:///%E8%B5%84%E6%96%99/notes/a%20b.md#part')
  expect(resolveDocumentLink('#part', path)).toBe('#part')
  expect(resolveDocumentMedia('https://example.com/a.png', path)).toBe('https://example.com/a.png')
  expect(resolveLocalResource('../images/100%.png', path)?.path).toBe('/资料/images/100%.png')
})

it('accepts Windows drive, extended and UNC document paths', () => {
  expect(fileUrl('\\\\?\\C:\\notes\\a.md').href).toBe('file:///C:/notes/a.md')
  expect(fileUrl('\\\\?\\UNC\\server\\share\\a.md').href).toBe('file://server/share/a.md')
  expect(resolveLocalResource('../images/a.png', 'C:\\notes\\a.md')?.path).toBe('C:/images/a.png')
})
