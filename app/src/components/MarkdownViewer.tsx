import React, { memo, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeRaw from 'rehype-raw'
import 'github-markdown-css/github-markdown.css'
import './MarkdownViewer.css'
import { getRenderer } from '../modules/markdown/plugins'
import { preparePreviewMarkdown, type PreviewBlockChunk, type PreviewMarkdownResult } from '../modules/markdown/previewPipeline'
import { getDefaultPerformanceSettings, getPerformanceSettings, type PerformanceSettings } from '../modules/settings/editorSettings'
import { subscribePerformanceSettingsChanged } from '../modules/settings/performanceRuntime'
import { remarkToc } from '../modules/markdown/remarkToc'
import { splitAlignedTabInlineNodes } from '../modules/markdown/alignedTab'
import { rehypeSourceLineAnchors } from '../modules/markdown/rehypeSourceLineAnchors'
import { DownloadOnClickUseCase, TauriWebviewOpener } from '../modules/download/handleMarkdownLinkClick'
import { ExamAttachmentLinkClassifier } from '../modules/download/linkClassifier'
import { FetchTextDownloadService } from '../modules/download/downloadService'
import { TauriFileSaveService } from '../modules/download/fileSaveService'
import { convertFileSrc } from '@tauri-apps/api/core'

export type Renderer = (code: string) => React.ReactNode

export type FoldRegion = { fromLine: number; toLine: number }

export type MarkdownViewerMode = 'rendered' | 'source'

export interface MarkdownViewerProps {
  value: string
  previewWidth?: number
  filePath?: string | null
  foldRegions?: FoldRegion[]
  mode?: MarkdownViewerMode
  /** 当用户点击预览中的某个块时，返回对应的起始行号 */
  onLineClick?: (line: number) => void
  /** 预览区域文字选中变更回调 */
  onSelectionChange?: (text: string | null) => void
}

export interface MarkdownViewerHandle {
  updateActiveLine: (line: number) => void
}

function isPlainTextFile(path: string | null | undefined): boolean {
  if (!path) return false
  return path.toLowerCase().endsWith('.txt')
}

type LineRangeIndexEntry = {
  start: number
  end: number
  element: HTMLElement
}

type SourceLineIndex = Map<number, HTMLElement[]>

type ActiveSourceLine = {
  line: number
  elements: HTMLElement[]
}

const FoldContext = React.createContext<FoldRegion[]>([])
const FilePathContext = React.createContext<string | null>(null)
const SourceLineOffsetContext = React.createContext(0)
const useFoldRegions = () => React.useContext(FoldContext)

type MarkdownBlockChunk = PreviewBlockChunk

function findActiveLineRangeEntry(
  entries: LineRangeIndexEntry[],
  line: number,
  preferredIndex: number | null,
): { entry: LineRangeIndexEntry; index: number } | null {
  if (preferredIndex != null) {
    const preferred = entries[preferredIndex]
    if (preferred && line >= preferred.start && line <= preferred.end) {
      return { entry: preferred, index: preferredIndex }
    }
  }

  let best: { entry: LineRangeIndexEntry; index: number } | null = null
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (line < entry.start || line > entry.end) continue

    if (
      !best ||
      entry.end - entry.start < best.entry.end - best.entry.start ||
      (
        entry.end - entry.start === best.entry.end - best.entry.start &&
        index > best.index
      )
    ) {
      best = { entry, index }
    }
  }

  return best
}

function collectSourceLineIndex(container: HTMLElement): SourceLineIndex {
  const index: SourceLineIndex = new Map()
  const elements = Array.from(container.querySelectorAll<HTMLElement>('[data-source-line]'))

  for (const element of elements) {
    const parentMarker = element.parentElement?.closest<HTMLElement>('[data-source-line]')
    if (parentMarker && container.contains(parentMarker)) continue

    const line = Number(element.dataset.sourceLine)
    if (!Number.isInteger(line) || line < 1) continue

    const lineElements = index.get(line) ?? []
    lineElements.push(element)
    index.set(line, lineElements)
  }

  return index
}

function collectLineRangeIndex(container: HTMLElement): LineRangeIndexEntry[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-line-start][data-line-end]'))
    .map((element) => {
      const start = Number(element.dataset.lineStart)
      const end = Number(element.dataset.lineEnd)
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
        return null
      }
      return { start, end, element }
    })
    .filter((entry): entry is LineRangeIndexEntry => entry !== null)
}

function clearSourceLineHighlight(active: ActiveSourceLine | null) {
  active?.elements.forEach((element) => element.classList.remove('active-source-line'))
}

function scrollPreviewTarget(scrollParent: HTMLElement, targetElement: HTMLElement) {
  const parentRect = scrollParent.getBoundingClientRect()
  const targetRect = targetElement.getBoundingClientRect()
  const isVisible =
    targetRect.top >= parentRect.top &&
    targetRect.bottom <= parentRect.bottom

  if (!isVisible) {
    const currentBottomOffset = parentRect.height - (targetRect.bottom - parentRect.top)
    const desiredBottomOffset = parentRect.height / 4
    const delta = desiredBottomOffset - currentBottomOffset
    scrollParent.scrollTo({ top: scrollParent.scrollTop + delta })
  }
}

// KaTeX 按需加载：单例 Promise + 独立订阅，避免加载完成时重渲染整个预览树
type KatexRenderOptions = Record<string, unknown>
type KatexModule = { renderToString: (tex: string, options?: KatexRenderOptions) => string }

let katexInstance: KatexModule | null = null
let katexPromise: Promise<KatexModule> | null = null
const katexListeners = new Set<() => void>()

function subscribeKatex(listener: () => void): () => void {
  katexListeners.add(listener)
  return () => {
    katexListeners.delete(listener)
  }
}

function getKatexSnapshot(): KatexModule | null {
  return katexInstance
}

function useKatex(): KatexModule | null {
  return React.useSyncExternalStore(subscribeKatex, getKatexSnapshot, getKatexSnapshot)
}

function loadKatex(): Promise<KatexModule> {
  if (katexInstance) return Promise.resolve(katexInstance)
  if (!katexPromise) {
    katexPromise = Promise.all([
      import('katex'),
      import('katex/dist/katex.min.css'),
    ])
      .then(([mod]) => {
        katexInstance = mod.default
        for (const listener of katexListeners) {
          listener()
        }
        return katexInstance
      })
      .catch((error) => {
        katexPromise = null
        throw error
      })
  }
  return katexPromise
}

// 为 math / inlineMath 节点打上 data-line-start / data-line-end 属性，便于后续按行号折叠
function remarkMathLineAnchors() {
  return (tree: any) => {
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return

      if (node.type === 'math' || node.type === 'inlineMath') {
        const pos = node.position
        const startLine = pos?.start?.line
        const endLine = pos?.end?.line ?? startLine



        if (typeof startLine === 'number') {
          if (!node.data) node.data = {}
          if (!node.data.hProperties) node.data.hProperties = {}
          node.data.hProperties['data-line-start'] = String(startLine)
          if (endLine != null) node.data.hProperties['data-line-end'] = String(endLine)

        }
      }

      if (Array.isArray(node.children)) {
        for (const child of node.children) walk(child)
      }
    }

    walk(tree)
  }
}

function remarkPreserveSingleLineBreaks() {
  return (tree: any) => {
    const walk = (node: any) => {
      if (!node || typeof node !== 'object' || !Array.isArray(node.children)) return

      const nextChildren: any[] = []
      for (const child of node.children) {
        if (child?.type === 'text' && typeof child.value === 'string' && child.value.includes('\n')) {
          const parts = child.value.split(/\r?\n/)
          const startLine = child.position?.start?.line
          parts.forEach((part: string, index: number) => {
            const line = typeof startLine === 'number' ? startLine + index : null
            const position = child.position && line != null
              ? {
                  ...child.position,
                  start: { ...child.position.start, line },
                  end: { ...child.position.end, line },
                }
              : child.position
            if (part.length > 0) {
              nextChildren.push({
                ...child,
                value: part,
                position,
              })
            }
            if (index < parts.length - 1) {
              nextChildren.push({
                type: 'break',
                ...(position ? { position } : {}),
                ...(line != null
                  ? { data: { hProperties: { 'data-source-line': String(line) } } }
                  : {}),
              })
            }
          })
          continue
        }

        walk(child)
        nextChildren.push(child)
      }

      node.children = nextChildren
    }

    walk(tree)
  }
}

function rehypeAlignedTabBlocks() {
  return (tree: any) => {
    const paragraphToAlignedRows = (node: any) => {
      if (
        node?.type !== 'element' ||
        node.tagName !== 'p' ||
        !Array.isArray(node.children)
      ) {
        return null
      }

      return splitAlignedTabInlineNodes<any>(node.children, {
        getText: (child) => child?.type === 'text' && typeof child.value === 'string' ? child.value : null,
        createText: (value, source) => ({ ...source, value }),
      })
    }

    const rowsToAlignedBlock = (rows: any[], position?: any) => ({
      type: 'element',
      tagName: 'div',
      properties: { className: ['md-align-block'] },
      position,
      children: rows.map((row) => ({
        type: 'element',
        tagName: 'span',
        properties: { className: ['md-align-row'] },
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: ['md-align-left'] },
            children: row.left,
          },
          {
            type: 'element',
            tagName: 'span',
            properties: { className: ['md-align-right'] },
            children: row.right,
          },
        ],
      })),
    })

    const isWhitespaceTextNode = (node: any) => (
      node?.type === 'text' &&
      typeof node.value === 'string' &&
      node.value.trim().length === 0
    )

    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return
      if (!Array.isArray(node.children)) return

      const nextChildren: any[] = []
      for (let index = 0; index < node.children.length; index += 1) {
        const child = node.children[index]
        if (isWhitespaceTextNode(child)) {
          nextChildren.push(child)
          continue
        }

        const rows = paragraphToAlignedRows(child)
        if (!rows) {
          walk(child)
          nextChildren.push(child)
          continue
        }

        const groupedRows = [...rows]
        let endIndex = index
        for (let nextIndex = index + 1; nextIndex < node.children.length; nextIndex += 1) {
          const nextChild = node.children[nextIndex]
          if (isWhitespaceTextNode(nextChild)) {
            endIndex = nextIndex
            continue
          }

          const nextRows = paragraphToAlignedRows(nextChild)
          if (!nextRows) break
          groupedRows.push(...nextRows)
          endIndex = nextIndex
        }

        nextChildren.push(
          rowsToAlignedBlock(groupedRows, {
            start: child.position?.start,
            end: node.children[endIndex]?.position?.end,
          }),
        )
        index = endIndex
      }

      node.children = nextChildren
    }

    walk(tree)
  }
}

// Markdown 链接点击用例：点击特定链接时触发下载并保存，其余链接走内置浏览器
const markdownLinkClickHandler = new DownloadOnClickUseCase(
  new ExamAttachmentLinkClassifier(),
  new FetchTextDownloadService(),
  new TauriFileSaveService(),
  new TauriWebviewOpener(),
)

// KaTeX 渲染结果缓存，按内容去重
const blockMathHtmlCache = new Map<string, string>()
const inlineMathHtmlCache = new Map<string, string>()
const KATEX_CACHE_LIMIT = 512

function getCachedKatexHtml(cache: Map<string, string>, key: string): string | undefined {
  const cached = cache.get(key)
  if (cached === undefined) return undefined

  cache.delete(key)
  cache.set(key, cached)
  return cached
}

function setCachedKatexHtml(cache: Map<string, string>, key: string, html: string): void {
  cache.delete(key)
  cache.set(key, html)
  while (cache.size > KATEX_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value
    if (oldestKey === undefined) break
    cache.delete(oldestKey)
  }
}

function renderBlockMathHtml(tex: string, katexInstance: KatexModule | null): string {
  if (!katexInstance) return tex
  const key = tex
  const cached = getCachedKatexHtml(blockMathHtmlCache, key)
  if (cached !== undefined) return cached
  let html = ''
  try {
    html = katexInstance.renderToString(tex, { displayMode: true, throwOnError: false })
  } catch {
    html = tex
  }
  setCachedKatexHtml(blockMathHtmlCache, key, html)
  return html
}

function renderInlineMathHtml(tex: string, katexInstance: KatexModule | null): string {
  if (!katexInstance) return tex
  const key = tex
  const cached = getCachedKatexHtml(inlineMathHtmlCache, key)
  if (cached !== undefined) return cached
  let html = ''
  try {
    html = katexInstance.renderToString(tex, { displayMode: false, throwOnError: false })
  } catch {
    html = tex
  }
  setCachedKatexHtml(inlineMathHtmlCache, key, html)
  return html
}

// remark → rehype 阶段：将 math / inlineMath 映射为自定义标签，携带原始行号
const remarkRehypeOptions: any = {
  handlers: {
    // 在 mdast-util-to-hast 中，handler 形如 (state, node, parent) ⇒ HastNode
    // 这里我们直接返回一个 plain 对象作为 HAST element，不再依赖 state.h
    math(_state: any, node: any) {
      const pos = node.position
      const props: any = { value: node.value }
      return {
       type: 'element',
       tagName: 'math',
        properties: props,
        children: [],
        position: pos,
      }
    },
    inlineMath(_state: any, node: any) {
      const pos = node.position
      const props: any = { value: node.value }
      return {
        type: 'element',
        tagName: 'inlineMath',
        properties: props,
        children: [],
        position: pos,
      }
    },
  },
}

const DiagramsLazy = React.lazy(() => import('./diagrams'))


// 判断一个块 [start, end] 是否与任一折叠区间有重叠
const isBlockFolded = (regions: FoldRegion[], start?: number, end?: number): boolean => {
  if (!regions.length || !start) return false
  const s = start
  const e = end ?? start
  return regions.some((r) => !(e < r.fromLine || s > r.toLine))
}

const MarkdownBlockElement = memo(({ tag, children, className, node: _node, ...rest }: any) => (
  React.createElement(tag, { className, ...rest }, children)
))

type DiagramBlockProps = {
  lang: 'mermaid' | 'mind'
  code: string
}

// 提取稳定的媒体组件，避免受 foldRegions 变动影响导致视频重刷
const MarkdownMedia = memo(({ node, filePath, ...props }: any) => {
  const [loadFailed, setLoadFailed] = useState(false)
  const altText = props.alt || ''
  const widthMatch = /\(([\d.]+(?:px|%|rem|vw))\)$/.exec(altText)
  const maxWidth = widthMatch ? widthMatch[1] : '100%'
  const cleanAlt = altText.replace(/\(([\d.]+(?:px|%|rem|vw))\)$/, '').trim()
  const src = props.src || ''
  let finalSrc = src

  if (filePath && src && !src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('data:')) {
    const fileDir = filePath.replace(/[/\\][^/\\]+$/, '')
    const sep = filePath.includes('\\') ? '\\' : '/'
    let absPath = src
    if (src.startsWith('.')) {
      const parts = src.split(/[\/\\]/)
      let dir = fileDir
      for (const part of parts) {
        if (part === '..') dir = dir.replace(/[/\\][^/\\]+$/, '')
        else if (part !== '.') dir = dir + sep + part
      }
      absPath = dir
    } else if (!src.match(/^[a-zA-Z]:/)) {
      absPath = fileDir + sep + src
    }

    finalSrc = convertFileSrc(absPath.replace(/\\/g, '/'), 'haomd')
  }

  useEffect(() => {
    setLoadFailed(false)
  }, [finalSrc])

  const lowerAlt = cleanAlt.toLowerCase()
  const isAudio = lowerAlt === 'audio' || lowerAlt === '音频' || /\.(mp3|wav|m4a|ogg|flac)$/i.test(src)

  if (isAudio) {
    return <audio controls src={finalSrc} style={{ width: maxWidth, display: 'block', margin: '0 auto' }}>您的浏览器不支持 audio 标签。</audio>
  }

  const isVideo = lowerAlt === 'video' || lowerAlt === '视频' || /\.(mp4|webm|mov|ogg|ogv)$/i.test(src)
  if (isVideo) {
    const parts = cleanAlt.split('|')
    const posterAlt = parts[1]?.trim()
    let posterUrl = ''
    if (posterAlt && filePath && !posterAlt.startsWith('http')) {
      // 简化的 poster 路径逻辑
      posterUrl = finalSrc.substring(0, finalSrc.lastIndexOf('/') + 1) + encodeURIComponent(posterAlt)
    }
    return <video controls preload="metadata" poster={posterUrl || undefined} src={finalSrc} style={{ width: maxWidth, maxWidth: '100%', height: 'auto', display: 'block', margin: '0 auto' }}>您的浏览器不支持 video 标签。</video>
  }

  if (loadFailed) {
    return (
      <span
        style={{
          maxWidth,
          minHeight: 56,
          display: 'block',
          margin: '0 auto',
          padding: '12px 14px',
          borderRadius: 6,
          border: '1px dashed rgba(255,255,255,0.2)',
          color: 'var(--theme-text-muted, #8b949e)',
          background: 'color-mix(in srgb, var(--theme-bg-secondary, #161b22) 76%, transparent)',
          fontSize: 13,
          lineHeight: 1.5,
          boxSizing: 'border-box',
        }}
      >
        <strong style={{ display: 'block', color: 'var(--theme-text-default, #c9d1d9)', marginBottom: 4 }}>
          图片未找到
        </strong>
        <span>{cleanAlt || src || '未提供图片路径'}</span>
      </span>
    )
  }

  return <img {...props} src={finalSrc} loading="lazy" alt={cleanAlt} style={{ maxWidth, height: 'auto', display: 'block', margin: '0 auto' }} onError={() => { setLoadFailed(true) }} />
})

const DiagramBlock = memo(
  ({ lang, code }: DiagramBlockProps) => (
    <React.Suspense fallback={<pre>图表加载中…</pre>}>
      <DiagramsLazy lang={lang} code={code} />
    </React.Suspense>
  ),
  (prev, next) => prev.lang === next.lang && prev.code === next.code,
)

const LazyCodeBlock = React.lazy(() => import('./CodeBlockHighlighted'))

function renderPlainCodeLines(content: string, sourceLineStart?: number): React.ReactNode {
  if (sourceLineStart == null) return content

  return content.split(/\r?\n/).map((line: string, index: number, lines: string[]) => (
    <React.Fragment key={index}>
      <span data-source-line={String(sourceLineStart + index)}>{line}</span>
      {index < lines.length - 1 ? '\n' : null}
    </React.Fragment>
  ))
}

const StableCode = memo(({ inline, className, children, node, ...rest }: any) => {
  const content = String(children).trim()
  const match = /language-([\w]+)/.exec(className || '')
  const lang = match?.[1]
  const sourceLineOffset = React.useContext(SourceLineOffsetContext)
  const nodeStartLine = node?.position?.start?.line
  const contentLineCount = content.split(/\r?\n/).length
  const blockLineCount = typeof nodeStartLine === 'number' && typeof node?.position?.end?.line === 'number'
    ? node.position.end.line - nodeStartLine + 1
    : contentLineCount
  const sourceLineStart = typeof nodeStartLine === 'number'
    ? nodeStartLine + (blockLineCount > contentLineCount ? 1 : 0) + sourceLineOffset
    : undefined

  if (lang) {
    const renderer = getRenderer(lang)
    if (renderer) return renderer(content)
    if (lang === 'mermaid' || lang === 'mind') return <DiagramBlock lang={lang} code={content} />
    return (
      <React.Suspense fallback={<pre><code className={className}>{renderPlainCodeLines(content, sourceLineStart)}</code></pre>}>
        <LazyCodeBlock lang={lang} content={content} sourceLineStart={sourceLineStart} {...rest} />
      </React.Suspense>
    )
  }

  const isMultiline = content.includes('\n')
  if (!isMultiline) return <code className="code" {...rest}>{content}</code>
  return (
    <pre {...rest}>
      <code className="plain">
        {renderPlainCodeLines(content, sourceLineStart)}
      </code>
    </pre>
  )
})

const StableMath = memo(({ node, value, ...rest }: any) => {
  const katex = useKatex()

  const tex = (value ?? (node as any).value ?? '').trim()
  const html = renderBlockMathHtml(tex, katex)
  return <div {...rest} dangerouslySetInnerHTML={{ __html: html }} />
})

const StableInlineMath = memo(({ node, value, ...rest }: any) => {
  const katex = useKatex()

  const tex = (value ?? (node as any).value ?? '').trim()
  const html = renderInlineMathHtml(tex, katex)
  return <span {...rest} dangerouslySetInnerHTML={{ __html: html }} />
})

type MarkdownBlockChunkProps = {
  chunk: MarkdownBlockChunk
  components: any
  remarkPlugins: any[]
  rehypePlugins: any[]
  sourceLineOffset: number
  filePath: string | null
  onElementChange: (chunk: MarkdownBlockChunk, element: HTMLElement | null) => void
}

const MarkdownChunkContent = memo(({
  markdown,
  components,
  remarkPlugins,
  rehypePlugins,
  sourceLineOffset,
  filePath,
}: {
  markdown: string
  components: any
  remarkPlugins: any[]
  rehypePlugins: any[]
  sourceLineOffset: number
  filePath: string | null
}) => {
  const chunkRehypePlugins = useMemo(
    () => [...rehypePlugins, [rehypeSourceLineAnchors, { lineOffset: sourceLineOffset }]],
    [rehypePlugins, sourceLineOffset],
  )

  return (
    <SourceLineOffsetContext.Provider value={sourceLineOffset}>
      <FilePathContext.Provider value={filePath}>
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          remarkRehypeOptions={remarkRehypeOptions}
          rehypePlugins={chunkRehypePlugins}
          components={components}
        >
          {markdown}
        </ReactMarkdown>
      </FilePathContext.Provider>
    </SourceLineOffsetContext.Provider>
  )
}, (prev, next) => (
  prev.markdown === next.markdown &&
  prev.filePath === next.filePath &&
  prev.components === next.components &&
  prev.remarkPlugins === next.remarkPlugins &&
  prev.rehypePlugins === next.rehypePlugins &&
  prev.sourceLineOffset === next.sourceLineOffset
))

const MarkdownBlockChunkView = memo(({
  chunk,
  components,
  remarkPlugins,
  rehypePlugins,
  sourceLineOffset,
  filePath,
  onElementChange,
}: MarkdownBlockChunkProps) => {
  const elementRef = useRef<HTMLDivElement | null>(null)
  const regions = useFoldRegions()
  const chunkStartLine = sourceLineOffset + chunk.startLine
  const chunkEndLine = sourceLineOffset + chunk.endLine
  const isFolded = isBlockFolded(regions, chunkStartLine, chunkEndLine)
  useLayoutEffect(() => {
    onElementChange(chunk, isFolded ? null : elementRef.current)
    return () => {
      onElementChange(chunk, null)
    }
  }, [chunk, isFolded, onElementChange])

  if (isFolded) return null

  return (
    <div
      ref={elementRef}
      className="markdown-block-chunk"
      data-line-start={chunkStartLine}
      data-line-end={chunkEndLine}
    >
      <MarkdownChunkContent
        markdown={chunk.markdown}
        components={components}
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        sourceLineOffset={sourceLineOffset}
        filePath={filePath}
      />
    </div>
  )
}, (prev, next) =>
  prev.chunk.id === next.chunk.id &&
  prev.chunk.startLine === next.chunk.startLine &&
  prev.chunk.endLine === next.chunk.endLine &&
  prev.chunk.markdown === next.chunk.markdown &&
  prev.filePath === next.filePath &&
  prev.components === next.components &&
  prev.remarkPlugins === next.remarkPlugins &&
  prev.rehypePlugins === next.rehypePlugins &&
  prev.sourceLineOffset === next.sourceLineOffset,
)

type MarkdownDocumentProps = {
  mode: MarkdownViewerMode
  blockRenderingEnabled: boolean
  blockChunks: MarkdownBlockChunk[]
  renderedValue: string
  sourceValue: string
  sourceLineOffset: number
  components: any
  remarkPlugins: any[]
  rehypePlugins: any[]
  filePath: string | null
  onElementChange: (chunk: MarkdownBlockChunk, element: HTMLElement | null) => void
}

const MarkdownDocument = ({
  mode,
  blockRenderingEnabled,
  blockChunks,
  renderedValue,
  sourceValue,
  sourceLineOffset,
  components,
  remarkPlugins,
  rehypePlugins,
  filePath,
  onElementChange,
}: MarkdownDocumentProps) => {
  const documentRehypePlugins = useMemo(
    () => [...rehypePlugins, [rehypeSourceLineAnchors, { lineOffset: sourceLineOffset }]],
    [rehypePlugins, sourceLineOffset],
  )

  if (mode !== 'rendered') {
    return (
      <pre className="markdown-source">
        <code>{sourceValue}</code>
      </pre>
    )
  }

  if (blockRenderingEnabled) {
    return (
      <>
        {blockChunks.map((chunk) => (
          <MarkdownBlockChunkView
            key={chunk.id}
            chunk={chunk}
            components={components}
            remarkPlugins={remarkPlugins}
            rehypePlugins={rehypePlugins}
            sourceLineOffset={sourceLineOffset + chunk.startLine - 1}
            filePath={filePath}
            onElementChange={onElementChange}
          />
        ))}
      </>
    )
  }

  return (
    <SourceLineOffsetContext.Provider value={sourceLineOffset}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        remarkRehypeOptions={remarkRehypeOptions}
        rehypePlugins={documentRehypePlugins}
        components={components}
      >
        {renderedValue}
      </ReactMarkdown>
    </SourceLineOffsetContext.Provider>
  )
}

const areMarkdownDocumentPropsEqual = (
  previous: MarkdownDocumentProps,
  next: MarkdownDocumentProps,
) => (
  previous.mode === next.mode &&
  previous.blockRenderingEnabled === next.blockRenderingEnabled &&
  previous.blockChunks === next.blockChunks &&
  previous.components === next.components &&
  previous.remarkPlugins === next.remarkPlugins &&
  previous.rehypePlugins === next.rehypePlugins &&
  previous.sourceLineOffset === next.sourceLineOffset &&
  previous.filePath === next.filePath &&
  previous.onElementChange === next.onElementChange &&
  (next.mode === 'rendered'
    ? previous.renderedValue === next.renderedValue
    : previous.sourceValue === next.sourceValue)
)

const MemoizedMarkdownDocument = memo(MarkdownDocument, areMarkdownDocumentPropsEqual)
MemoizedMarkdownDocument.displayName = 'MemoizedMarkdownDocument'

const MarkdownViewerComponent = React.forwardRef<
  MarkdownViewerHandle,
  Readonly<MarkdownViewerProps>
>(function MarkdownViewerComponent(props, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const activeLineIndexRef = useRef<LineRangeIndexEntry[]>([])
  const activeLineEntryRef = useRef<{ entry: LineRangeIndexEntry; index: number } | null>(null)
  const sourceLineIndexRef = useRef<SourceLineIndex>(new Map())
  const activeSourceLineRef = useRef<ActiveSourceLine | null>(null)
  const activeLineRef = useRef<number | undefined>(undefined)
  const activeLineRafRef = useRef<number | null>(null)
  const chunkElementMapRef = useRef(new Map<string, HTMLElement>())
  const previewWorkerRef = useRef<Worker | null>(null)
  const previewRequestIdRef = useRef(0)
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const {
    value,
    previewWidth,
    filePath,
    foldRegions,
    mode = 'rendered',
    onLineClick,
    onSelectionChange,
  } = props
  const plainTextMode = isPlainTextFile(filePath)
  const [performanceSettings, setPerformanceSettings] = useState<PerformanceSettings>(getDefaultPerformanceSettings())
  const [previewResult, setPreviewResult] = useState<PreviewMarkdownResult>(() => preparePreviewMarkdown(value))

  useEffect(() => {
    let cancelled = false
    void getPerformanceSettings().then((settings) => {
      if (!cancelled) setPerformanceSettings(settings)
    })
    const unsubscribe = subscribePerformanceSettingsChanged((settings) => {
      setPerformanceSettings(settings)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!performanceSettings.experimentalPreviewOptimization || mode !== 'rendered' || typeof Worker === 'undefined') {
      previewWorkerRef.current?.terminate()
      previewWorkerRef.current = null
      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current)
        previewTimerRef.current = null
      }
      return
    }

    if (previewWorkerRef.current) return

    const worker = new Worker(new URL('../workers/markdownPreview.worker.ts', import.meta.url), { type: 'module' })
    previewWorkerRef.current = worker
    worker.onmessage = (
      event: MessageEvent<{
        id: number
        processedMarkdown: string
        hasMath: boolean
        containsToc: boolean
        sourceLineOffset: number
        lineCount: number
        blockChunks: PreviewBlockChunk[]
      }>,
    ) => {
      if (event.data.id !== previewRequestIdRef.current) return
      startTransition(() => {
        if (event.data.id !== previewRequestIdRef.current) return
        setPreviewResult({
          processedMarkdown: event.data.processedMarkdown,
          hasMath: event.data.hasMath,
          containsToc: event.data.containsToc,
          sourceLineOffset: event.data.sourceLineOffset,
          lineCount: event.data.lineCount,
          blockChunks: event.data.blockChunks,
        })
      })
    }

    return () => {
      worker.terminate()
      if (previewWorkerRef.current === worker) {
        previewWorkerRef.current = null
      }
    }
  }, [
    mode,
    performanceSettings.experimentalPreviewOptimization,
  ])
  useEffect(() => {
    if (mode !== 'rendered') return

    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current)
    }

    const requestId = ++previewRequestIdRef.current
    if (!performanceSettings.experimentalPreviewOptimization) {
      const nextResult = preparePreviewMarkdown(value)
      startTransition(() => {
        if (requestId !== previewRequestIdRef.current) return
        setPreviewResult(nextResult)
      })
      return
    }

    previewTimerRef.current = setTimeout(() => {
      const worker = previewWorkerRef.current
      if (!worker) {
        startTransition(() => {
          setPreviewResult(preparePreviewMarkdown(value))
        })
        return
      }
      worker.postMessage({ id: requestId, value })
    }, 160)

    return () => {
      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current)
        previewTimerRef.current = null
      }
    }
  }, [mode, value, performanceSettings.experimentalPreviewOptimization])

  useEffect(() => {
    return () => {
      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current)
      }
      previewWorkerRef.current?.terminate()
      previewWorkerRef.current = null
    }
  }, [])

  const renderedValue = previewResult.processedMarkdown
  const sourceLineOffset = previewResult.sourceLineOffset

  const applyActiveLine = useCallback((nextActiveLine: number | undefined) => {
    if (activeLineRafRef.current != null) {
      cancelAnimationFrame(activeLineRafRef.current)
      activeLineRafRef.current = null
    }

    const container = containerRef.current
    const currentSourceLine = activeSourceLineRef.current
    const currentBlock = activeLineEntryRef.current

    if (!container || mode !== 'rendered' || typeof nextActiveLine !== 'number' || nextActiveLine < 1) {
      clearSourceLineHighlight(currentSourceLine)
      activeSourceLineRef.current = null
      if (currentBlock) currentBlock.entry.element.classList.remove('active-block')
      activeLineEntryRef.current = null
      if (!container || mode !== 'rendered') {
        sourceLineIndexRef.current = new Map()
        activeLineIndexRef.current = []
      }
      return
    }

    activeLineRafRef.current = requestAnimationFrame(() => {
      activeLineRafRef.current = null
      let sourceLineElements = sourceLineIndexRef.current.get(nextActiveLine) ?? []
      if (sourceLineElements.length === 0) {
        sourceLineIndexRef.current = collectSourceLineIndex(container)
        sourceLineElements = sourceLineIndexRef.current.get(nextActiveLine) ?? []
      }

      if (sourceLineElements.length > 0) {
        clearSourceLineHighlight(activeSourceLineRef.current)
        if (activeLineEntryRef.current) {
          activeLineEntryRef.current.entry.element.classList.remove('active-block')
          activeLineEntryRef.current = null
        }
        sourceLineElements.forEach((element) => element.classList.add('active-source-line'))
        activeSourceLineRef.current = { line: nextActiveLine, elements: sourceLineElements }
        const scrollParent = container.closest('.preview-body') as HTMLElement | null
        if (scrollParent) scrollPreviewTarget(scrollParent, sourceLineElements[0])
        return
      }

      clearSourceLineHighlight(activeSourceLineRef.current)
      activeSourceLineRef.current = null
      const current = activeLineEntryRef.current
      if (current && nextActiveLine >= current.entry.start && nextActiveLine <= current.entry.end) return

      const target = findActiveLineRangeEntry(
        activeLineIndexRef.current,
        nextActiveLine,
        current?.index ?? null,
      )
      if (!target) {
        if (current) current.entry.element.classList.remove('active-block')
        activeLineEntryRef.current = null
        return
      }

      if (current && current.entry.element !== target.entry.element) {
        current.entry.element.classList.remove('active-block')
      }
      target.entry.element.classList.add('active-block')
      activeLineEntryRef.current = target
      const scrollParent = container.closest('.preview-body') as HTMLElement | null
      if (scrollParent) scrollPreviewTarget(scrollParent, target.entry.element)
    })
  }, [mode])

  React.useImperativeHandle(ref, () => ({
    updateActiveLine: (line: number) => {
      activeLineRef.current = line
      applyActiveLine(line)
    },
  }), [applyActiveLine])

  // KaTeX 按需加载：检测文档是否包含数学公式
  const hasMath = previewResult.hasMath
  const shouldLoadKatex = hasMath || (
    mode === 'rendered' &&
    !plainTextMode &&
    /\$/.test(value)
  )
  useEffect(() => {
    if (!shouldLoadKatex) return
    void loadKatex().catch((error) => {
      console.error('[MarkdownViewer] failed to load KaTeX', error)
    })
  }, [shouldLoadKatex])

  const blockRenderingEnabled = useMemo(() => (
    mode === 'rendered' &&
    !plainTextMode &&
    !previewResult.containsToc &&
    previewResult.lineCount >= 120
  ), [mode, plainTextMode, previewResult.containsToc, previewResult.lineCount])
  const blockChunks = useMemo(() => (
    blockRenderingEnabled ? previewResult.blockChunks : []
  ), [blockRenderingEnabled, previewResult.blockChunks])
  const rehypePlugins = useMemo(() => [rehypeAlignedTabBlocks, rehypeRaw], [])
  const handleChunkElementChange = useCallback((chunk: MarkdownBlockChunk, element: HTMLElement | null) => {
    if (element) {
      chunkElementMapRef.current.set(chunk.id, element)
    } else {
      chunkElementMapRef.current.delete(chunk.id)
    }
  }, [])

  const components = useMemo(() => {
    return {
      p: (p: any) => <MarkdownBlockElement tag="p" {...p} />,
      h1: (p: any) => <MarkdownBlockElement tag="h1" {...p} />,
      h2: (p: any) => <MarkdownBlockElement tag="h2" {...p} />,
      h3: (p: any) => <MarkdownBlockElement tag="h3" {...p} />,
      h4: (p: any) => <MarkdownBlockElement tag="h4" {...p} />,
      h5: (p: any) => <MarkdownBlockElement tag="h5" {...p} />,
      h6: (p: any) => <MarkdownBlockElement tag="h6" {...p} />,
      ul: (p: any) => <MarkdownBlockElement tag="ul" {...p} />,
      ol: (p: any) => <MarkdownBlockElement tag="ol" {...p} />,
      li: (p: any) => <MarkdownBlockElement tag="li" {...p} />,
      blockquote: (p: any) => <MarkdownBlockElement tag="blockquote" {...p} />,
      div: (p: any) => <MarkdownBlockElement tag="div" {...p} />,
      span: ({ className, children, ...rest }: any) => <span className={className} {...rest}>{children}</span>,
      math: StableMath,
      inlineMath: StableInlineMath,
      // rehypeRaw follows HTML parsing rules and lowercases custom tag names.
      inlinemath: StableInlineMath,
      a: ({ href, children, ...props }: any) => {
        const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
          if (!href) return

          const el = e.currentTarget as HTMLAnchorElement

          // 预览内部锚点（例如 TOC 链接）：在预览滚动容器中平滑滚动到对应标题
          if (href.startsWith('#')) {
            e.preventDefault()
            const container = containerRef.current
            if (!container) return

            let targetEl: HTMLElement | null = null

            const targetLine = el.dataset.targetLine
            if (targetLine) {
              targetEl = container.querySelector<HTMLElement>(`[data-line-start="${targetLine}"]`)
            }

            if (!targetEl) {
              const id = href.slice(1)
              targetEl = container.querySelector<HTMLElement>(`#${id}`) || document.getElementById(id)
            }

            if (!targetEl) return

            const scrollParent = container.closest('.preview-body') as HTMLElement | null
            if (!scrollParent) return

            const parentRect = scrollParent.getBoundingClientRect()
            const targetRect = targetEl.getBoundingClientRect()
            const currentTop = scrollParent.scrollTop
            const delta = targetRect.top - parentRect.top
            const offset = currentTop + delta - parentRect.height / 8

            scrollParent.scrollTo({ top: offset, behavior: 'smooth' })
            return
          }

          // 其他链接仍然走下载 / 外部打开逻辑
          e.preventDefault()
          void markdownLinkClickHandler.handleClick(href)
        }
        return (
          <a href={href} onClick={handleClick} {...props}>
            {children}
          </a>
        )
      },
      img: (innerProps: any) => (
        <FilePathContext.Consumer>
          {path => <MarkdownMedia {...innerProps} filePath={path} />}
        </FilePathContext.Consumer>
      ),
      pre: (p: any) => <MarkdownBlockElement tag="pre" {...p} />,
      code: StableCode,
    }
  }, []) // 稳定引用

  const activeRemarkPlugins = useMemo(
    () => plainTextMode
      ? [remarkGfm, remarkMath, remarkMathLineAnchors, remarkToc, remarkPreserveSingleLineBreaks]
      : [remarkGfm, remarkMath, remarkMathLineAnchors, remarkToc],
    [plainTextMode],
  )

  useLayoutEffect(() => {
    const container = containerRef.current
    clearSourceLineHighlight(activeSourceLineRef.current)
    activeSourceLineRef.current = null
    const currentActive = activeLineEntryRef.current
    if (currentActive) {
      currentActive.entry.element.classList.remove('active-block')
      activeLineEntryRef.current = null
    }

    if (!container || mode !== 'rendered') {
      sourceLineIndexRef.current = new Map()
      activeLineIndexRef.current = []
      return
    }

    sourceLineIndexRef.current = collectSourceLineIndex(container)
    const chunkIndex = blockChunks
      .map((chunk) => {
        const element = chunkElementMapRef.current.get(chunk.id)
        if (!element) return null
        return {
          start: sourceLineOffset + chunk.startLine,
          end: sourceLineOffset + chunk.endLine,
          element,
        }
      })
      .filter((entry): entry is LineRangeIndexEntry => entry !== null)

    const documentIndex = collectLineRangeIndex(container)
    activeLineIndexRef.current = documentIndex.length > 0 ? documentIndex : chunkIndex
  }, [blockChunks, foldRegions, mode, renderedValue, sourceLineOffset])

  // 保存和恢复滚动位置
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const scrollParent = container.closest('.preview-body') as HTMLElement | null
    if (!scrollParent) return

    const savedScrollTop = scrollParent.scrollTop
    const wasNearBottom = scrollParent.scrollHeight - scrollParent.scrollTop - scrollParent.clientHeight < 100

    if (wasNearBottom) {
      scrollParent.scrollTop = scrollParent.scrollHeight
    } else {
      scrollParent.scrollTop = savedScrollTop
    }
  }, [renderedValue])

  // 内容树更新后，重新应用最近一次的行高亮，不触发 Markdown 组件树重渲染。
  useLayoutEffect(() => {
    if (activeLineRef.current !== undefined) {
      applyActiveLine(activeLineRef.current)
    }
    return () => {
      if (activeLineRafRef.current != null) {
        cancelAnimationFrame(activeLineRafRef.current)
        activeLineRafRef.current = null
      }
    }
  }, [
    activeRemarkPlugins,
    applyActiveLine,
    blockChunks,
    blockRenderingEnabled,
    foldRegions,
    mode,
    previewResult.lineCount,
    rehypePlugins,
    renderedValue,
    sourceLineOffset,
  ])
  useEffect(() => {
    const container = containerRef.current
    if (!container || !onLineClick || mode !== 'rendered') return

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return

      // 避免点击超链接或交互控件时触发跳转编辑器
      if (target.closest('a, button, input, textarea')) return

      const sourceLine = target.closest<HTMLElement>('[data-source-line]')
      if (sourceLine) {
        const line = Number(sourceLine.dataset.sourceLine)
        if (Number.isInteger(line) && line > 0) {
          onLineClick(line)
          return
        }
      }

      const block = target.closest<HTMLElement>('[data-line-start]')
      if (!block) return

      const start = Number(block.dataset.lineStart)
      if (!start || Number.isNaN(start)) return

      onLineClick(start)
    }

    container.addEventListener('click', handleClick)
    return () => {
      container.removeEventListener('click', handleClick)
    }
  }, [onLineClick, mode])

  // 将 Markdown 预览中的文字选区同步给上层（Ask AI About Selection 使用）
  useEffect(() => {
    const container = containerRef.current
    if (!container || !onSelectionChange || mode !== 'rendered') return

    const syncSelectionFromWindow = () => {
      if (typeof window === 'undefined') {
        onSelectionChange(null)
        return
      }
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) {
        onSelectionChange(null)
        return
      }
      const isInContainer = (node: Node | null) => !!node && container.contains(node)
      const anchorNode = sel.anchorNode
      const focusNode = sel.focusNode
      if (!isInContainer(anchorNode) && !isInContainer(focusNode)) {
        onSelectionChange(null)
        return
      }
      const text = sel.toString().trim()
      onSelectionChange(text || null)
    }

    const handleMouseUp = () => {
      syncSelectionFromWindow()
    }

    const handleKeyUp = () => {
      syncSelectionFromWindow()
    }

    container.addEventListener('mouseup', handleMouseUp)
    container.addEventListener('keyup', handleKeyUp)

    return () => {
      container.removeEventListener('mouseup', handleMouseUp)
      container.removeEventListener('keyup', handleKeyUp)
      onSelectionChange(null)
    }
  }, [onSelectionChange, mode])

  return (
    <FilePathContext.Provider value={filePath ?? null}>
      <FoldContext.Provider value={foldRegions ?? []}>
        <div className="markdown-body gh-markdown" ref={containerRef} data-preview-width={previewWidth}>
          <MemoizedMarkdownDocument
            mode={mode}
            blockRenderingEnabled={blockRenderingEnabled}
            blockChunks={blockChunks}
            renderedValue={renderedValue}
            sourceValue={value}
            sourceLineOffset={previewResult.sourceLineOffset}
            components={components}
            remarkPlugins={activeRemarkPlugins}
            rehypePlugins={rehypePlugins}
            filePath={filePath ?? null}
            onElementChange={handleChunkElementChange}
          />
        </div>
      </FoldContext.Provider>
    </FilePathContext.Provider>
  )
})

export const MarkdownViewer = memo(
  MarkdownViewerComponent,
  (prev, next) => (
    prev.value === next.value &&
    prev.filePath === next.filePath &&
    prev.mode === next.mode &&
    prev.foldRegions === next.foldRegions
  ),
)
MarkdownViewer.displayName = 'MarkdownViewer'
