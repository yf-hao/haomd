import { describe, it, expect } from 'vitest'
import { rehypeMathLineAnchors } from './rehypeMathLineAnchors'

describe('rehypeMathLineAnchors', () => {
    it('should add line anchors to katex-display elements', () => {
        const tree = {
            type: 'root',
            children: [
                {
                    type: 'element',
                    tagName: 'div',
                    properties: { className: ['katex-display'] },
                    position: {
                        start: { line: 5, column: 1 },
                        end: { line: 7, column: 10 }
                    },
                    children: []
                }
            ]
        } as any

        const attach = rehypeMathLineAnchors()
        attach(tree)

        const element = tree.children[0]
        expect(element.properties['data-line-start']).toBe('5')
        expect(element.properties['data-line-end']).toBe('7')
    })

    it('should add line anchors to inline katex elements', () => {
        const tree = {
            type: 'root',
            children: [
                {
                    type: 'element',
                    tagName: 'span',
                    properties: { className: ['katex'] },
                    position: {
                        start: { line: 10, column: 5 },
                        end: { line: 10, column: 15 }
                    },
                    children: []
                }
            ]
        } as any

        const attach = rehypeMathLineAnchors()
        attach(tree)

        const element = tree.children[0]
        expect(element.properties['data-line-start']).toBe('10')
        expect(element.properties['data-line-end']).toBe('10')
    })

    it('should inherit position from parent if node does not have one', () => {
        const tree = {
            type: 'element',
            tagName: 'div',
            position: { start: { line: 20 } },
            children: [
                {
                    type: 'element',
                    tagName: 'span',
                    properties: { className: ['katex'] },
                    children: []
                }
            ]
        } as any

        const attach = rehypeMathLineAnchors()
        attach(tree)

        const child = tree.children[0]
        expect(child.properties['data-line-start']).toBe('20')
    })

    it('should not override existing line anchors', () => {
        const tree = {
            type: 'element',
            tagName: 'span',
            properties: {
                className: ['katex'],
                'data-line-start': '99'
            },
            position: { start: { line: 1 } },
            children: []
        } as any

        const attach = rehypeMathLineAnchors()
        attach(tree)

        expect(tree.properties['data-line-start']).toBe('99')
    })
})
