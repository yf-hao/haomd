import { describe, expect, it } from 'vitest'
import { fileUrl, relocateMarkdown, relocateUrl } from './relocationPlanner'

const move = { oldPath: '/notes/drafts/note.md', newPath: '/notes/archive/note01.md' }

describe('resource-preserving file relocation', () => {
  it('rewrites concrete destinations while preserving layout, titles, CRLF and code', () => {
    const input = '---\r\ntitle: "[leave](a.md)"\r\n---\r\n\r\n![图](<images/a b.png> "title")\r\n[ref link][r]\r\n\r\n[r]: ./reference.md#段落 "title"\r\n\r\n`[code](a.md)`\r\n```md\r\n![code](a.png)\r\n```\r\n'
    const output = relocateMarkdown(input, move.oldPath, move)
    expect(output).toContain('![图](<../drafts/images/a%20b.png> "title")')
    expect(output).toContain('[r]: ../drafts/reference.md#%E6%AE%B5%E8%90%BD "title"')
    expect(output).toContain('title: "[leave](a.md)"')
    expect(output).toContain('`[code](a.md)`\r\n```md\r\n![code](a.png)\r\n```')
    expect(output.match(/\r\n/g)?.length).toBe(input.match(/\r\n/g)?.length)
  })

  it('updates inbound links and self links using the actual numbered filename', () => {
    expect(relocateMarkdown('[self](note.md#one) [anchor](#two)', move.oldPath, move))
      .toBe('[self](note01.md#one) [anchor](#two)')
    expect(relocateMarkdown('[note](drafts/note.md?mode=1#one)', '/notes/index.md', move))
      .toBe('[note](archive/note01.md?mode=1#one)')
    expect(relocateMarkdown('[encoded self](%6eote.md)', move.oldPath, move)).toBe('[encoded self](note01.md)')
  })

  it('preserves resource identity, encoded separators and unrelated URLs', () => {
    for (const url of ['./images/a%23b.png?size=1#preview', './a(b).md', '../reference.md', 'missing.png']) {
      const next = relocateUrl(url, move.oldPath, move)
      expect(new URL(next, fileUrl(move.newPath)).href).toBe(new URL(url, fileUrl(move.oldPath)).href)
    }
    for (const url of ['https://example.com/a.png', '//example.com/a', '#one', 'data:image/png;base64,AA', 'mailto:a@example.com']) {
      expect(relocateUrl(url, move.oldPath, move)).toBe(url)
    }
  })

  it('rewrites HTML media attributes and ignores comments', () => {
    const source = '<img src="images/a.png" srcset="images/a.png 1x, images/b.png 2x">\n<a href="note.md#one">self</a>\n<!-- <img src="unchanged.png"> -->'
    const output = relocateMarkdown(source, move.oldPath, move)
    expect(output).toContain('src="../drafts/images/a.png"')
    expect(output).toContain('srcset="../drafts/images/a.png 1x, ../drafts/images/b.png 2x"')
    expect(output).toContain('href="note01.md#one"')
    expect(output).toContain('<!-- <img src="unchanged.png"> -->')
  })

  it('supports Windows paths and does not rewrite plain-text files', () => {
    const windows = { oldPath: 'C:\\notes\\a.md', newPath: 'C:\\archive\\a.md' }
    expect(relocateUrl('images/a.png', windows.oldPath, windows)).toBe('../notes/images/a.png')
    expect(relocateMarkdown('[a](a.png)', '/a.txt', { oldPath: '/a.txt', newPath: '/new/a.txt' })).toBe('[a](a.png)')
  })

  it('preserves math and data srcset candidates while rebasing local candidates', () => {
    const text = '$[x](math.md)$\n\n$$\n[x](math.md)\n$$\n\n<img srcset="data:image/png;base64,AAAA 1x, images/b.png 2x, images/c.png, images/d.png 4x">'
    const output = relocateMarkdown(text, move.oldPath, move)
    expect(output).toContain('$[x](math.md)$')
    expect(output).toContain('$$\n[x](math.md)\n$$')
    expect(output).toContain('data:image/png;base64,AAAA 1x, ../drafts/images/b.png 2x, ../drafts/images/c.png, ../drafts/images/d.png 4x')
  })

  it('rejects unsupported HTML base during preflight before disk writes', () => {
    expect(() => relocateMarkdown('<base href="./elsewhere/">', move.oldPath, move, true)).toThrow('HTML base')
  })

  it('updates explicit file autolinks and rejects dynamic MDX resources', () => {
    expect(relocateMarkdown('<file:///notes/drafts/note.md#part>', '/notes/index.md', move))
      .toBe('<file:///notes/archive/note01.md#part>')
    expect(() => relocateMarkdown('<img src={imageUrl} />', '/notes/a.mdx', move, true)).toThrow('动态 MDX')
    expect(() => relocateMarkdown('`<img src={imageUrl} />`', '/notes/a.mdx', move, true)).not.toThrow()
  })
})
