import { StateEffect, RangeSetBuilder } from '@codemirror/state'
import { EditorView, Decoration, ViewPlugin } from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { SearchQuery } from '@codemirror/search'

// 定义自定义更新搜索状态的信号
export const setCustomSearchQuery = StateEffect.define<SearchQuery | null>()

const matchMark = Decoration.mark({ class: 'cm-customSearchMatch' })
const selectedMatchMark = Decoration.mark({ class: 'cm-customSearchMatch cm-customSearchMatch-selected' })

// 极高对比度的实色高亮方案
const searchHighlightTheme = EditorView.theme({
    '.cm-customSearchMatch': {
        backgroundColor: '#fde047', // 亮黄色
        color: '#1e293b !important', // 深色文字保证对比度
        borderRadius: '2px',
    },
    '.cm-customSearchMatch.cm-customSearchMatch-selected': {
        backgroundColor: '#38bdf8 !important', // 亮蓝色
        color: '#0f172a !important', // 极深色文字
        borderRadius: '2px',
        boxShadow: '0 0 8px rgba(56, 189, 248, 0.8)',
        zIndex: 10,
    }
})

class SearchHighlightPluginClass {
    decorations: DecorationSet
    query: SearchQuery | null = null

    constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view)
    }

    update(update: ViewUpdate) {
        let queryChanged = false

        for (const tr of update.transactions) {
            for (const effect of tr.effects) {
                if (effect.is(setCustomSearchQuery)) {
                    this.query = effect.value as SearchQuery
                    queryChanged = true
                }
            }
        }

        // 只有当搜索词改变、文档内容改变或光标位置改变时才重新计算
        if (queryChanged || update.docChanged || update.selectionSet) {
            this.decorations = this.buildDecorations(update.view)
        }
    }

    buildDecorations(view: EditorView) {
        if (!this.query || !this.query.search) {
            return Decoration.none
        }

        const builder = new RangeSetBuilder<Decoration>()
        // 绕过泛型版本冲突
        const cursor = this.query.getCursor(view.state) as any
        const selection = view.state.selection.main

        const matches = []
        while (!cursor.next().done) {
            const matchFrom = cursor.value?.from ?? cursor.from
            const matchTo = cursor.value?.to ?? cursor.to

            if (typeof matchFrom === 'number' && typeof matchTo === 'number') {
                matches.push({ from: matchFrom, to: matchTo })
            }
        }

        // RangeSetBuilder 需要按偏移量升序添加
        matches.sort((a, b) => a.from - b.from)

        for (const match of matches) {
            // 若当前光标位于此匹配项，认为是当前选中项
            const isSelected = match.from <= selection.to && match.to >= selection.from
            builder.add(match.from, match.to, isSelected ? selectedMatchMark : matchMark)
        }

        return builder.finish()
    }
}

export const searchHighlightPlugin = ViewPlugin.fromClass(SearchHighlightPluginClass, {
    decorations: v => v.decorations
})

export function customSearchHighlight() {
    return [searchHighlightPlugin, searchHighlightTheme]
}
