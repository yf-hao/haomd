import { describe, expect, it, vi } from 'vitest'
import { Schema } from '@milkdown/prose/model'
import { buildHeadingsFromWysiwygDoc, createWysiwygOutlineReader } from './wysiwygOutline'

type FakeNode = {
  type: unknown
  attrs: Record<string, unknown>
  textContent: string
}

type FakeDoc = {
  descendants: (fn: (node: FakeNode, pos: number) => boolean | void) => void
}

function createFakeDoc(nodes: FakeNode[]): FakeDoc {
  return {
    descendants: (fn) => {
      nodes.forEach((node, index) => {
        fn(node, index)
      })
    },
  }
}

describe('buildHeadingsFromWysiwygDoc', () => {
  it('reuses immutable subtrees and keeps heading order after insertions', () => {
    const schema = new Schema({ nodes: {
      doc: { content: 'block*' }, text: {},
      paragraph: { content: 'text*', group: 'block' },
      heading: { content: 'text*', group: 'block', attrs: { level: { default: 1 } } },
      blockquote: { content: 'block*', group: 'block' },
    } })
    const title = schema.node('heading', null, schema.text('标题'))
    const nested = schema.node('blockquote', null, schema.node('heading', { level: 2 }, schema.text('子标题')))
    const body = schema.node('paragraph', null, schema.text('正文'))
    const read = createWysiwygOutlineReader()
    const first = read(schema.node('doc', null, [title, nested, body]), schema.nodes.heading)
    const visitNested = vi.spyOn(nested, 'forEach')
    const edited = schema.node('paragraph', null, schema.text('修改正文'))
    expect(read(schema.node('doc', null, [title, nested, edited]), schema.nodes.heading)).toBe(first)
    expect(visitNested).not.toHaveBeenCalled()
    const next = schema.node('doc', null, [schema.node('heading', null, schema.text('新增')), title, nested, edited])
    expect(read(next, schema.nodes.heading)).toEqual(buildHeadingsFromWysiwygDoc({ doc: next, headingType: schema.nodes.heading }))
    visitNested.mockRestore()
  })

  it('should return an empty list for a document without headings', () => {
    const headingType = { name: 'heading' }
    const doc = createFakeDoc([
      { type: { name: 'paragraph' }, attrs: {}, textContent: 'Body' },
    ])

    expect(
      buildHeadingsFromWysiwygDoc({
        doc: doc as never,
        headingType: headingType as never,
      }),
    ).toEqual([])
  })

  it('should extract heading level, text and headingIndex from the doc', () => {
    const headingType = { name: 'heading' }
    const doc = createFakeDoc([
      { type: headingType, attrs: { level: 1 }, textContent: 'Title' },
      { type: { name: 'paragraph' }, attrs: {}, textContent: 'Body' },
      { type: headingType, attrs: { level: 2 }, textContent: 'Section' },
      { type: headingType, attrs: { level: 3 }, textContent: 'Detail' },
    ])

    expect(
      buildHeadingsFromWysiwygDoc({
        doc: doc as never,
        headingType: headingType as never,
      }),
    ).toEqual([
      {
        id: 'wysiwyg-heading-0',
        text: 'Title',
        level: 1,
        source: 'wysiwyg',
        headingIndex: 0,
      },
      {
        id: 'wysiwyg-heading-1',
        text: 'Section',
        level: 2,
        source: 'wysiwyg',
        headingIndex: 1,
      },
      {
        id: 'wysiwyg-heading-2',
        text: 'Detail',
        level: 3,
        source: 'wysiwyg',
        headingIndex: 2,
      },
    ])
  })

  it('should ignore empty headings and invalid levels', () => {
    const headingType = { name: 'heading' }
    const doc = createFakeDoc([
      { type: headingType, attrs: { level: 0 }, textContent: 'Bad' },
      { type: headingType, attrs: { level: 7 }, textContent: 'Bad' },
      { type: headingType, attrs: { level: 2 }, textContent: '   ' },
      { type: headingType, attrs: { level: 2 }, textContent: 'Valid' },
    ])

    expect(
      buildHeadingsFromWysiwygDoc({
        doc: doc as never,
        headingType: headingType as never,
      }),
    ).toEqual([
      {
        id: 'wysiwyg-heading-0',
        text: 'Valid',
        level: 2,
        source: 'wysiwyg',
        headingIndex: 0,
      },
    ])
  })
})
