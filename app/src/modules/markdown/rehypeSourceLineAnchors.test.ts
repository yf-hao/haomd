import { describe, expect, it } from 'vitest'
import { rehypeSourceLineAnchors } from './rehypeSourceLineAnchors'

describe('rehypeSourceLineAnchors', () => {
  it('adds block ranges and splits multiline text into source-line spans', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          position: {
            start: { line: 2 },
            end: { line: 3 },
          },
          children: [
            {
              type: 'text',
              value: 'first line\nsecond line',
              position: {
                start: { line: 2 },
                end: { line: 3 },
              },
            },
          ],
        },
      ],
    } as any

    rehypeSourceLineAnchors()(tree)

    const paragraph = tree.children[0]
    expect(paragraph.properties['data-line-start-local']).toBe('2')
    expect(paragraph.properties['data-line-end-local']).toBe('3')
    expect(paragraph.children[0].properties['data-source-line-local']).toBe('2')
    expect(paragraph.children[0].children[0].value).toBe('first line')
    expect(paragraph.children[1].value).toBe('\n')
    expect(paragraph.children[2].properties['data-source-line-local']).toBe('3')
  })

  it('marks a single-line block without wrapping its text', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'h2',
          position: {
            start: { line: 5 },
            end: { line: 5 },
          },
          children: [{ type: 'text', value: 'Heading' }],
        },
      ],
    } as any

    rehypeSourceLineAnchors()(tree)

    const heading = tree.children[0]
    expect(heading.properties['data-line-start-local']).toBe('5')
    expect(heading.properties['data-line-end-local']).toBe('5')
    expect(heading.properties['data-source-line-local']).toBe('5')
    expect(heading.children[0].type).toBe('text')
  })

  it('keeps code contents intact and uses the code block range as fallback', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'pre',
          position: {
            start: { line: 8 },
            end: { line: 11 },
          },
          children: [
            {
              type: 'element',
              tagName: 'code',
              position: {
                start: { line: 9 },
                end: { line: 10 },
              },
              children: [
                {
                  type: 'text',
                  value: 'const a = 1\nconst b = 2',
                  position: {
                    start: { line: 9 },
                    end: { line: 10 },
                  },
                },
              ],
            },
          ],
        },
      ],
    } as any

    rehypeSourceLineAnchors()(tree)

    const pre = tree.children[0]
    const code = pre.children[0]
    expect(pre.properties['data-line-start-local']).toBe('8')
    expect(pre.properties['data-line-end-local']).toBe('11')
    expect(code.children[0].type).toBe('text')
    expect(code.children[0].value).toBe('const a = 1\nconst b = 2')
    expect(code.children[0].properties).toBeUndefined()
  })

  it('keeps source lines local to the rendered document or chunk', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          position: {
            start: { line: 1 },
            end: { line: 2 },
          },
          children: [
            {
              type: 'text',
              value: 'chunk line one\nchunk line two',
              position: {
                start: { line: 1 },
                end: { line: 2 },
              },
            },
          ],
        },
      ],
    } as any

    rehypeSourceLineAnchors()(tree)

    const paragraph = tree.children[0]
    expect(paragraph.properties['data-line-start-local']).toBe('1')
    expect(paragraph.properties['data-line-end-local']).toBe('2')
    expect(paragraph.children[0].properties['data-source-line-local']).toBe('1')
    expect(paragraph.children[2].properties['data-source-line-local']).toBe('2')
  })

  it('does not rewrite line attributes created by earlier Markdown plugins', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'math',
          properties: {
            'data-line-start-local': '2',
            'data-line-end-local': '4',
          },
          position: {
            start: { line: 2 },
            end: { line: 4 },
          },
          children: [],
        },
      ],
    } as any

    rehypeSourceLineAnchors()(tree)

    expect(tree.children[0].properties['data-line-start-local']).toBe('2')
    expect(tree.children[0].properties['data-line-end-local']).toBe('4')
  })
})
