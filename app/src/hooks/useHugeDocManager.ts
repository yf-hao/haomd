import { useEffect, useState } from 'react'
import { countLines, extractChunkAroundLine } from '../modules/editor/chunkEdit'
import { getHugeDocSettings } from '../modules/settings/editorSettings'

export type HugeDocState = {
    enabled: boolean
    threshold: number
    currentChunk: {
        from: number
        to: number
        value: string
    } | null
}

const DEFAULT_HUGE_DOC_LINE_THRESHOLD = 1000
const DEFAULT_ENABLE_HUGE_DOC_LOCAL_EDIT = true
const DEFAULT_HUGE_DOC_CHUNK_CONTEXT_LINES = 200
const DEFAULT_HUGE_DOC_CHUNK_MAX_LINES = 400

export type HugeDocManagerOptions = {
    markdown: string
    activeLine: number
}

export function useHugeDocManager({ markdown, activeLine }: HugeDocManagerOptions) {
    const [hugeDocState, setHugeDocState] = useState<HugeDocState | null>(null)
    const [hugeDocEnabled, setHugeDocEnabled] = useState(DEFAULT_ENABLE_HUGE_DOC_LOCAL_EDIT)
    const [hugeDocLineThreshold, setHugeDocLineThreshold] = useState(DEFAULT_HUGE_DOC_LINE_THRESHOLD)
    const [hugeDocChunkContextLines, setHugeDocChunkContextLines] = useState(DEFAULT_HUGE_DOC_CHUNK_CONTEXT_LINES)
    const [hugeDocChunkMaxLines, setHugeDocChunkMaxLines] = useState(DEFAULT_HUGE_DOC_CHUNK_MAX_LINES)

    useEffect(() => {
        let cancelled = false
            ; (async () => {
                try {
                    const cfg = await getHugeDocSettings()
                    if (cancelled) return
                    // 关闭大文档局部编辑：始终使用整篇文档，不再按 chunk 裁剪编辑器内容
                    setHugeDocEnabled(false)
                    setHugeDocLineThreshold(cfg.lineThreshold)
                    setHugeDocChunkContextLines(cfg.chunkContextLines)
                    setHugeDocChunkMaxLines(cfg.chunkMaxLines)
                } catch (e) {
                    console.error('[useHugeDocManager] load hugeDoc settings failed, using defaults', e)
                }
            })()
        return () => {
            cancelled = true
        }
    }, [])

    // Huge doc detection & initial chunk computation（只负责开启/关闭和首次初始化，不反复重算）
    useEffect(() => {
        if (!hugeDocEnabled) {
            setHugeDocState(null)
            return
        }

        const lineCount = countLines(markdown)
        const enabled = lineCount >= hugeDocLineThreshold

        if (!enabled) {
            if (hugeDocState) {
                console.debug('[HugeDoc] disabled for current document, lineCount =', lineCount)
            }
            setHugeDocState(null)
            return
        }

        // 已经有有效 chunk，则不在这里自动重算，避免与程序性跳转互相覆盖
        if (hugeDocState?.enabled && hugeDocState.currentChunk) {
            return
        }

        try {
            const centerLine = activeLine > 0 ? activeLine : 1
            const chunk = extractChunkAroundLine(markdown, centerLine, {
                contextLines: hugeDocChunkContextLines,
                maxLines: hugeDocChunkMaxLines,
            })

            console.debug('[HugeDoc] enabled, lineCount =', lineCount, 'chunk =', {
                from: chunk.from,
                to: chunk.to,
                length: chunk.value.length,
            })

            setHugeDocState({
                enabled: true,
                threshold: hugeDocLineThreshold,
                currentChunk: chunk,
            })
        } catch (e) {
            console.error('[HugeDoc] failed to compute chunk for huge doc, fallback to normal mode', e)
            setHugeDocState(null)
        }
    }, [markdown, activeLine, hugeDocEnabled, hugeDocLineThreshold, hugeDocChunkContextLines, hugeDocChunkMaxLines, hugeDocState])

    return {
        hugeDocState,
        setHugeDocState,
        hugeDocEnabled,
        hugeDocLineThreshold,
        hugeDocChunkContextLines,
        hugeDocChunkMaxLines,
    }
}
