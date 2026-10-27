import { StateEffect, RangeSetBuilder } from '@codemirror/state'
import { EditorView, Decoration, ViewPlugin } from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { createLatestTaskScheduler } from '../../modules/document/taskScheduler'
import { SearchQuery } from '@codemirror/search'

// 定义自定义更新搜索状态的信号
export const setCustomSearchQuery = StateEffect.define<SearchQuery | null>()

const matchMark = Decoration.mark({ class: 'cm-customSearchMatch' })
const selectedMatchMark = Decoration.mark({ class: 'cm-customSearchMatch-selected' })
const replaceMatches = StateEffect.define<DecorationSet>()

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
    decorations: DecorationSet = Decoration.none
    selectedDecorations: DecorationSet = Decoration.none
    query: SearchQuery | null = null
    private scheduler = createLatestTaskScheduler()
    private destroyed = false

    update(update: ViewUpdate) {
        let queryChanged = false
        let matchesChanged = false
        for (const tr of update.transactions) {
            for (const effect of tr.effects) {
                if (effect.is(setCustomSearchQuery)) {
                    this.query = effect.value
                    queryChanged = true
                } else if (effect.is(replaceMatches)) {
                    this.decorations = effect.value
                    matchesChanged = true
                }
            }
        }
        if (queryChanged) {
            this.scheduler.cancel()
            this.decorations = this.buildMatches(update.view)
        } else if (update.docChanged) {
            // Preserve positions immediately, then refresh the global index outside typing.
            this.decorations = this.decorations.map(update.changes)
            const doc = update.state.doc
            const query = this.query
            if (query?.search) {
                this.scheduler.schedule(() => {
                    const view = update.view
                    if (this.destroyed || view.state.doc !== doc || this.query !== query) return
                    view.dispatch({ effects: replaceMatches.of(this.buildMatches(view)) })
                }, { minIntervalMs: 100, trailingDelayMs: 100, maxWaitMs: 300 })
            }
        }
        if (queryChanged || matchesChanged || update.docChanged || update.selectionSet) {
            const selection = update.state.selection.main
            const builder = new RangeSetBuilder<Decoration>()
            this.decorations.between(Math.max(0, selection.from - 1), Math.min(update.state.doc.length, selection.to + 1),
                (from, to) => {
                    if (from <= selection.to && to >= selection.from) builder.add(from, to, selectedMatchMark)
                })
            this.selectedDecorations = builder.finish()
        }
    }

    private buildMatches(view: EditorView) {
        if (!this.query?.search) return Decoration.none
        const builder = new RangeSetBuilder<Decoration>()
        const cursor = this.query.getCursor(view.state)
        for (let match = cursor.next(); !match.done; match = cursor.next()) {
            const { from, to } = match.value
            if (from < to) builder.add(from, to, matchMark)
        }
        return builder.finish()
    }

    destroy() { this.destroyed = true; this.scheduler.cancel() }
}

export const searchHighlightPlugin = ViewPlugin.fromClass(SearchHighlightPluginClass, {
    decorations: plugin => plugin.decorations,
    provide: plugin => EditorView.decorations.of(view => view.plugin(plugin)?.selectedDecorations ?? Decoration.none),
})

export function customSearchHighlight() {
    return [searchHighlightPlugin, searchHighlightTheme]
}
