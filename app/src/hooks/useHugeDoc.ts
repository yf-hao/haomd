import { useCallback, useEffect, useRef, useState } from 'react'
import { countLines, extractChunkAroundLine, applyChunkPatch, localToGlobalLine } from '../modules/editor/chunkEdit'
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

export interface UseHugeDocParams {
  markdown: string
  markdownRef: React.RefObject<string>
  activeLine: number
}

export interface UseHugeDocReturn {
  hugeDocState: HugeDocState | null
  hugeDocStateRef: React.RefObject<HugeDocState | null>
  hugeDocEnabled: boolean
  /**
   * 当大文档模式启用时，将编辑器局部编辑的 val 合并回整篇文档。
   * 返回合并后的完整文档，若不处于大文档模式则返回 null，调用方应回退到普通逻辑。
   */
  applyChunkEdit: (val: string) => string | null
  /**
   * 返回应展示在编辑器中的内容。
   * 大文档模式返回当前 chunk 的内容，否则返回 null（调用方应使用完整 markdown）。
   */
  getChunkContent: () => string | null
  /**
   * 将编辑器局部行号转换为全局行号。
   * 如果不处于大文档模式，返回原始 localLine。
   */
  localToGlobal: (localLine: number) => number
  /**
   * 跳转到全局行号。返回 { localLine, searchText } 供 EditorPane 的 focusRequest 使用，
   * 或 null 表示大文档模式未启用（调用方应直接使用 globalLine 作为 localLine）。
   */
  focusOnGlobalLine: (globalLine: number, searchText?: string) => {
    localLine: number
    searchText?: string
  }
}

export function useHugeDoc({
  markdown,
  markdownRef,
  activeLine,
}: UseHugeDocParams): UseHugeDocReturn {
  const [hugeDocState, setHugeDocState] = useState<HugeDocState | null>(null)
  const [hugeDocEnabled, setHugeDocEnabled] = useState(DEFAULT_ENABLE_HUGE_DOC_LOCAL_EDIT)
  const [hugeDocLineThreshold, setHugeDocLineThreshold] = useState(DEFAULT_HUGE_DOC_LINE_THRESHOLD)
  const [hugeDocChunkContextLines, setHugeDocChunkContextLines] = useState(DEFAULT_HUGE_DOC_CHUNK_CONTEXT_LINES)
  const [hugeDocChunkMaxLines, setHugeDocChunkMaxLines] = useState(DEFAULT_HUGE_DOC_CHUNK_MAX_LINES)

  const hugeDocStateRef = useRef<HugeDocState | null>(null)
  useEffect(() => {
    hugeDocStateRef.current = hugeDocState
  }, [hugeDocState])

  // Load huge doc settings from backend
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
          console.error('[useHugeDoc] load hugeDoc settings failed, using defaults', e)
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

  const applyChunkEdit = useCallback((val: string): string | null => {
    const currentHugeDocState = hugeDocStateRef.current
    if (!hugeDocEnabled || !currentHugeDocState?.enabled || !currentHugeDocState.currentChunk) {
      return null
    }
    const { from, to } = currentHugeDocState.currentChunk
    return applyChunkPatch(markdownRef.current, { from, to }, val)
  }, [hugeDocEnabled, markdownRef])

  const getChunkContent = useCallback((): string | null => {
    if (hugeDocEnabled && hugeDocState?.enabled && hugeDocState.currentChunk) {
      return hugeDocState.currentChunk.value
    }
    return null
  }, [hugeDocEnabled, hugeDocState])

  const localToGlobal = useCallback((localLine: number): number => {
    const currentHugeDocState = hugeDocStateRef.current
    if (hugeDocEnabled && currentHugeDocState?.enabled && currentHugeDocState.currentChunk) {
      return localToGlobalLine(markdownRef.current, currentHugeDocState.currentChunk.from, localLine)
    }
    return localLine
  }, [hugeDocEnabled, markdownRef])

  const focusOnGlobalLine = useCallback((globalLine: number, searchText?: string): {
    localLine: number
    searchText?: string
  } => {
    const safeGlobal = globalLine > 0 ? globalLine : 1

    // 普通文档：直接用全局行号作为本地行号
    if (!hugeDocEnabled) {
      return { localLine: safeGlobal, searchText }
    }

    const totalLines = countLines(markdown)
    if (totalLines < hugeDocLineThreshold) {
      // 当前文档虽开启了大文档功能，但行数尚未达到阈值，退化为普通跳转
      setHugeDocState(null)
      return { localLine: safeGlobal, searchText }
    }

    try {
      const chunk = extractChunkAroundLine(markdown, safeGlobal, {
        contextLines: hugeDocChunkContextLines,
        maxLines: hugeDocChunkMaxLines,
      })

      const chunkStartGlobalLine = localToGlobalLine(markdown, chunk.from, 1)
      const totalLocalLines = countLines(chunk.value)
      let localLine = safeGlobal - chunkStartGlobalLine + 1
      if (localLine < 1) localLine = 1
      if (localLine > totalLocalLines) localLine = totalLocalLines

      setHugeDocState({
        enabled: true,
        threshold: hugeDocLineThreshold,
        currentChunk: chunk,
      })
      return { localLine, searchText }
    } catch (e) {
      console.error('[HugeDoc] focusOnGlobalLine failed, fallback to normal scroll', e)
      // 兜底：回退到整篇文档模式
      setHugeDocState(null)
      return { localLine: safeGlobal, searchText }
    }
  }, [markdown, hugeDocEnabled, hugeDocLineThreshold, hugeDocChunkContextLines, hugeDocChunkMaxLines])

  return {
    hugeDocState,
    hugeDocStateRef,
    hugeDocEnabled,
    applyChunkEdit,
    getChunkContent,
    localToGlobal,
    focusOnGlobalLine,
  }
}
