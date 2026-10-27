import { describe, expect, it, vi } from 'vitest'
import { Schema, type Node } from '@milkdown/prose/model'
import { BlockCacheManager } from './blockCache'

const schema = new Schema({ nodes: {
  doc: { content: 'block*' }, paragraph: { content: 'text*', group: 'block' },
  blockquote: { content: 'block+', group: 'block' }, text: {},
} })
const paragraph = (text: string) => schema.node('paragraph', null, text ? schema.text(text) : undefined)
const doc = (...nodes: Node[]) => schema.node('doc', null, nodes)
const serialize = (document: Node) => {
  const blocks: string[] = []
  document.forEach(node => blocks.push(node.type.name === 'blockquote' ? `> ${node.textContent}` : node.textContent))
  return blocks.join('\n\n') + '\n'
}

describe('block serialization cache', () => {
  it('reuses unchanged blocks across insertions, deletions and skipped intermediate jobs', () => {
    const blocks = Array.from({ length: 100 }, (_, index) => paragraph(`block ${index}`))
    const initial = doc(...blocks)
    const cache = new BlockCacheManager()
    const serializer = vi.fn(serialize)
    cache.buildFull(initial, serializer)
    serializer.mockClear()
    const skipped = doc(paragraph('intermediate'), ...blocks.slice(1))
    const inserted = doc(paragraph('latest'), paragraph('inserted'), ...blocks.slice(1))
    expect(cache.incrementalUpdate(skipped, inserted, serializer)).toBe(serialize(inserted))
    expect(serializer).toHaveBeenCalledTimes(2)
    serializer.mockClear()
    const deleted = doc(...blocks.slice(1))
    expect(cache.incrementalUpdate(inserted, deleted, serializer)).toBe(serialize(deleted))
    expect(serializer).not.toHaveBeenCalled()
    expect(cache.incrementalUpdate(deleted, deleted, serializer)).toBe(serialize(deleted))
  })

  it('preserves complete serializer semantics for dependent blocks and unsupported separators', () => {
    const initial = doc(paragraph('plain'))
    const cache = new BlockCacheManager()
    cache.buildFull(initial, serialize)
    const nested = doc(schema.node('blockquote', null, paragraph('nested')), paragraph('tail'))
    expect(cache.incrementalUpdate(initial, nested, serialize)).toBe(serialize(nested))
    const noTrailingNewline = (value: Node) => serialize(value).trimEnd()
    cache.buildFull(initial, noTrailingNewline)
    const next = doc(paragraph('changed'), paragraph('tail'))
    expect(cache.incrementalUpdate(initial, next, noTrailingNewline)).toBe(noTrailingNewline(next))
  })
})
