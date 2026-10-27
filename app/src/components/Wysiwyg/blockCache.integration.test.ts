import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Editor, rootCtx, parserCtx, serializerCtx, schemaCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { BlockCacheManager } from './blockCache'

let editor: Editor
beforeAll(async () => {
  editor = await Editor.make().config(ctx => ctx.set(rootCtx, document.createElement('div')))
    .use(commonmark).use(gfm).create()
})
afterAll(async () => { await editor?.destroy() })

describe('block cache with the real Milkdown serializer', () => {
  it('preserves empty paragraph and adjacent block semantics', () => {
    editor.action(ctx => {
      const parse = ctx.get(parserCtx)
      const serialize = ctx.get(serializerCtx)
      const initial = parse('first\n\nsecond')
      const cache = new BlockCacheManager()
      cache.buildFull(initial, serialize)
      const next = initial.type.create(null, [initial.firstChild!, ctx.get(schemaCtx).nodes.paragraph.create(), initial.lastChild!])
      expect(cache.incrementalUpdate(initial, next, serialize)).toBe(serialize(next))
    })
  })

  it.each([
    '# 标题\n\n普通文字 **加粗**\n\n另一段',
    '```ts\nconst a = 1\n```\n\n正文\n\n---',
    '- 列表一\n  - 嵌套\n\n- 列表二\n\n正文',
    '| A | B |\n| - | - |\n| 一 | 二 |\n\n正文',
    '[链接][ref]\n\n![图片](image.png)\n\n[ref]: https://example.com',
  ])('matches full serialization after edits: %s', markdown => {
    editor.action(ctx => {
      const parse = ctx.get(parserCtx)
      const serialize = ctx.get(serializerCtx)
      const initial = parse(markdown)
      const next = parse(markdown + '\n\n新增段落')
      const cache = new BlockCacheManager()
      expect(cache.buildFull(initial, serialize)).toBe(serialize(initial))
      expect(cache.incrementalUpdate(initial, next, serialize)).toBe(serialize(next))
      expect(cache.incrementalUpdate(next, initial, serialize)).toBe(serialize(initial))
    })
  })
})
