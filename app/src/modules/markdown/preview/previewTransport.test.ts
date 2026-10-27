import { describe, expect, it } from 'vitest'
import { preparePreviewMarkdown } from '../previewPipeline'
import { createPreviewDecoder, createPreviewEncoder } from './previewTransport'

const document = Array.from({ length: 80 }, (_, i) => `## Heading ${i}\n\n${'正文 '.repeat(20)}`).join('\n\n')

describe('preview transport', () => {
  it('transfers only changed blocks and preserves the complete rendering result', () => {
    const encode = createPreviewEncoder()
    const decode = createPreviewDecoder()
    const initial = preparePreviewMarkdown(document)
    const first = decode(structuredClone(encode(1, initial)))
    const changed = preparePreviewMarkdown(document + '新增')
    const response = encode(2, changed)
    expect(response.blockChunks).toBeUndefined()
    expect(response.chunkPatch?.inserted).toHaveLength(1)
    const second = decode(structuredClone(response))
    expect(second).toEqual(changed)
    expect(second.blockChunks[0]).toBe(first.blockChunks[0])
  })

  it('round-trips insertions, deletions, moved line offsets and full-document fallbacks', () => {
    const encode = createPreviewEncoder()
    const decode = createPreviewDecoder()
    const edits = [document, document.replace('Heading 30', 'Changed heading'),
      '前言\n\n' + document, document.slice(document.indexOf('## Heading 20')),
      '[toc]\n\n' + document, '', document]
    edits.forEach((value, i) => {
      const prepared = preparePreviewMarkdown(value)
      expect(decode(structuredClone(encode(i + 1, prepared)))).toEqual(prepared)
    })
  })

  it('rejects a missing base instead of displaying an incomplete document', () => {
    const encode = createPreviewEncoder()
    encode(1, preparePreviewMarkdown(document))
    const response = encode(2, preparePreviewMarkdown(document + 'changed'))
    expect(() => createPreviewDecoder()(response)).toThrow('base mismatch')
  })
})
