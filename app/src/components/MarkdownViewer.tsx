import React, { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeRaw from 'rehype-raw'
import 'github-markdown-css/github-markdown.css'
import './MarkdownViewer.css'
import { getRenderer } from '../modules/markdown/plugins'
import { preparePreviewMarkdown, type PreviewMarkdownResult } from '../modules/markdown/previewPipeline'
import { remarkToc } from '../modules/markdown/remarkToc'
import { splitAlignedTabInlineNodes } from '../modules/markdown/alignedTab'
import { DownloadOnClickUseCase, TauriWebviewOpener } from '../modules/download/handleMarkdownLinkClick'
import { ExamAttachmentLinkClassifier } from '../modules/download/linkClassifier'
import { FetchTextDownloadService } from '../modules/download/downloadService'
import { TauriFileSaveService } from '../modules/download/fileSaveService'

export type Renderer = (code: string) => React.ReactNode

export type FoldRegion = { fromLine: number; toLine: number }

export type MarkdownViewerMode = 'rendered' | 'source'

export interface MarkdownViewerProps {
  value: string
  activeLine?: number
  previewWidth?: number
  filePath?: string | null
  foldRegions?: FoldRegion[]
  mode?: MarkdownViewerMode
  /** 当用户点击预览中的某个块时，返回对应的起始行号 */
  onLineClick?: (line: number) => void
  /** 预览区域文字选中变更回调 */
  onSelectionChange?: (text: string | null) => void
}

function isPlainTextFile(path: string | null | undefined): boolean {
  if (!path) return false
  return path.toLowerCase().endsWith('.txt')
}

type LineRange = {
  start?: number
  end?: number
}

type LineRangeIndexEntry = {
  start: number
  end: number
  element: HTMLElement
}

const LineRangeContext = React.createContext<LineRange | undefined>(undefined)
const FoldContext = React.createContext<FoldRegion[]>([])
const FilePathContext = React.createContext<string | null>(null)

const useLineRange = () => React.useContext(LineRangeContext)
const useFoldRegions = () => React.useContext(FoldContext)

function findLastRangeStartIndex(entries: LineRangeIndexEntry[], line: number): number {
  let left = 0
  let right = entries.length - 1
  let result = -1

  while (left <= right) {
    const mid = (left + right) >> 1
    const current = entries[mid]
    if (current.start <= line) {
      result = mid
      left = mid + 1
    } else {
      right = mid - 1
    }
  }

  return result
}

function findActiveLineRangeEntry(
  entries: LineRangeIndexEntry[],
  line: number,
  preferredIndex: number | null,
): { entry: LineRangeIndexEntry; index: number } | null {
  const searchAround = (center: number, radius: number) => {
    if (center < 0 || entries.length === 0) return null
    const start = Math.max(0, center - radius)
    const end = Math.min(entries.length - 1, center + radius)

    for (let offset = 0; offset <= radius; offset += 1) {
      const left = center - offset
      const right = center + offset

      if (left >= start) {
        const entry = entries[left]
        if (line >= entry.start && line <= entry.end) {
          return { entry, index: left }
        }
      }

      if (offset === 0) continue

      if (right <= end) {
        const entry = entries[right]
        if (line >= entry.start && line <= entry.end) {
          return { entry, index: right }
        }
      }
    }

    return null
  }

  if (preferredIndex != null) {
    const local = searchAround(preferredIndex, 12)
    if (local) return local
  }

  const insertionIndex = findLastRangeStartIndex(entries, line)
  if (insertionIndex < 0) return null

  const local = searchAround(insertionIndex, 12)
  if (local) return local

  for (let index = insertionIndex - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (line >= entry.start && line <= entry.end) {
      return { entry, index }
    }
  }

  return null
}

// KaTeX 按需加载：单例 Promise + Context
type KatexModule = { renderToString: (tex: string, options?: any) => string }
const KatexContext = React.createContext<KatexModule | null>(null)

let katexPromise: Promise<KatexModule> | null = null
function loadKatex(): Promise<KatexModule> {
  if (!katexPromise) {
    katexPromise = Promise.all([
      import('katex'),
      import('katex/dist/katex.min.css'),
    ]).then(([mod]) => mod.default)
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
          parts.forEach((part: string, index: number) => {
            if (part.length > 0) {
              nextChildren.push({
                ...child,
                value: part,
              })
            }
            if (index < parts.length - 1) {
              nextChildren.push({
                type: 'break',
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

function renderBlockMathHtml(tex: string, katexInstance: KatexModule | null): string {
  if (!katexInstance) return tex
  const key = tex
  const cached = blockMathHtmlCache.get(key)
  if (cached) return cached
  let html = ''
  try {
    html = katexInstance.renderToString(tex, { displayMode: true, throwOnError: false })
  } catch {
    html = tex
  }
  blockMathHtmlCache.set(key, html)
  return html
}

function renderInlineMathHtml(tex: string, katexInstance: KatexModule | null): string {
  if (!katexInstance) return tex
  const key = tex
  const cached = inlineMathHtmlCache.get(key)
  if (cached) return cached
  let html = ''
  try {
    html = katexInstance.renderToString(tex, { displayMode: false, throwOnError: false })
  } catch {
    html = tex
  }
  inlineMathHtmlCache.set(key, html)
  return html
}

// 图片/媒体路径编码缓存，避免重复计算 haomd:// / https://haomd.localhost 路径
const mediaUrlCache = new Map<string, string>()

function encodeMediaPath(absPath: string, isWindows: boolean): string {
  const cacheKey = (isWindows ? 'win|' : 'unix|') + absPath
  const cached = mediaUrlCache.get(cacheKey)
  if (cached) return cached

  const pathParts = absPath.split(/([/\\])/)
  const encodedParts = pathParts.map((part: string) => {
    if (part === '/' || part === '\\') return part
    return encodeURIComponent(part)
  })
  const encoded = encodedParts.join('')
  const finalUrl = isWindows ? `https://haomd.localhost${encoded}` : `haomd://localhost${encoded}`
  mediaUrlCache.set(cacheKey, finalUrl)
  return finalUrl
}

// remark → rehype 阶段：将 math / inlineMath 映射为自定义标签，携带原始行号
const remarkRehypeOptions: any = {
  handlers: {
    // 在 mdast-util-to-hast 中，handler 形如 (state, node, parent) ⇒ HastNode
    // 这里我们直接返回一个 plain 对象作为 HAST element，不再依赖 state.h
    math(_state: any, node: any) {
      const pos = node.position
      const startLine = pos?.start?.line
      const endLine = pos?.end?.line ?? startLine
      const props: any = { value: node.value }
      if (typeof startLine === 'number') {
        props['data-line-start'] = startLine
        if (endLine != null) props['data-line-end'] = endLine
      }
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
      const startLine = pos?.start?.line
      const endLine = pos?.end?.line ?? startLine
      const props: any = { value: node.value }
      if (typeof startLine === 'number') {
        props['data-line-start'] = startLine
        if (endLine != null) props['data-line-end'] = endLine
      }
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

// 稳定版的基础容器组件
const FoldableBlock = memo(({ tag, hideOnFold, node, children, className, ...rest }: any) => {
  const regions = useFoldRegions()
  const start = node?.position?.start?.line as number | undefined
  const end = (node?.position?.end?.line ?? start) as number | undefined

  if (hideOnFold && isBlockFolded(regions, start, end)) return null

  const dataProps = start ? { 'data-line-start': start, 'data-line-end': end } : undefined
  const lineRange: LineRange = { start, end }

  return (
    <LineRangeContext.Provider value={lineRange}>
      {React.createElement(tag, { className, ...dataProps, ...rest }, children)}
    </LineRangeContext.Provider>
  )
})

type DiagramBlockProps = {
  lang: 'mermaid' | 'mind'
  code: string
}

// 提取稳定的媒体组件，避免受 foldRegions 变动影响导致视频重刷
const MarkdownMedia = memo(({ node, filePath, encodeMediaPath, ...props }: any) => {
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

    const pathParts = absPath.split(/([/\\])/)
    const encodedParts = pathParts.map((part: string) => (part === '/' || part === '\\') ? part : encodeURIComponent(part))
    const encoded = encodedParts.join('')
    const isWindows = filePath.includes('\\') || navigator.userAgent.includes('Windows')
    finalSrc = isWindows ? `https://haomd.localhost${encoded}` : `haomd://localhost${encoded}`
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

const StableCode = memo(({ inline, className, children, node, ...rest }: any) => {
  const regions = useFoldRegions()
  const content = String(children).trim()
  const match = /language-([\w]+)/.exec(className || '')
  const lang = match?.[1]

  const start = (node as any)?.position?.start?.line as number | undefined
  const end = (node as any)?.position?.end?.line ?? start
  if (!inline && isBlockFolded(regions, start, end)) return null

  if (lang) {
    const renderer = getRenderer(lang)
    if (renderer) return renderer(content)
    if (lang === 'mermaid' || lang === 'mind') return <DiagramBlock lang={lang} code={content} />
    return (
      <React.Suspense fallback={<pre><code className={className}>{content}</code></pre>}>
        <LazyCodeBlock lang={lang} content={content} {...rest} />
      </React.Suspense>
    )
  }

  const isMultiline = content.includes('\n')
  if (!isMultiline) return <code className="code" {...rest}>{content}</code>
  return <pre {...rest}><code className="plain">{content}</code></pre>
})

const StableMath = memo(({ node, value, ...rest }: any) => {
  const regions = useFoldRegions()
  const katex = React.useContext(KatexContext)
  const start = node?.position?.start?.line as number | undefined
  const end = (node?.position?.end?.line ?? start) as number | undefined

  if (isBlockFolded(regions, start, end)) return null

  const tex = (value ?? (node as any).value ?? '').trim()
  const html = renderBlockMathHtml(tex, katex)
  const dataProps = start ? { 'data-line-start': start, 'data-line-end': end } : undefined
  const lineRange: LineRange = { start, end }

  return (
    <LineRangeContext.Provider value={lineRange}>
      <div {...rest} {...dataProps} dangerouslySetInnerHTML={{ __html: html }} />
    </LineRangeContext.Provider>
  )
})

const StableInlineMath = memo(({ node, value, ...rest }: any) => {
  const regions = useFoldRegions()
  const katex = React.useContext(KatexContext)
  const lineRange = useLineRange()
  let start = lineRange?.start
  let end = lineRange?.end ?? start

  if (start == null) {
    const pos = node?.position
    start = pos?.start?.line as number | undefined
    end = (pos?.end?.line ?? start) as number | undefined
  }

  if (isBlockFolded(regions, start, end)) return null

  const tex = (value ?? (node as any).value ?? '').trim()
  const html = renderInlineMathHtml(tex, katex)

  return <span {...rest} dangerouslySetInnerHTML={{ __html: html }} />
})

function MarkdownViewerComponent(
  props: Readonly<MarkdownViewerProps>
) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const activeLineIndexRef = useRef<LineRangeIndexEntry[]>([])
  const activeLineEntryRef = useRef<{ entry: LineRangeIndexEntry; index: number } | null>(null)
  const previewWorkerRef = useRef<Worker | null>(null)
  const previewRequestIdRef = useRef(0)
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { value, activeLine, previewWidth, filePath, foldRegions, mode = 'rendered', onLineClick, onSelectionChange } = props
  const plainTextMode = isPlainTextFile(filePath)
  const [previewResult, setPreviewResult] = useState<PreviewMarkdownResult>(() => preparePreviewMarkdown(value))

  useEffect(() => {
    if (mode !== 'rendered') return
    if (typeof Worker === 'undefined') return

    const worker = new Worker(new URL('../workers/markdownPreview.worker.ts', import.meta.url), { type: 'module' })
    previewWorkerRef.current = worker
    worker.onmessage = (event: MessageEvent<{ id: number; processedMarkdown: string; hasMath: boolean }>) => {
      if (event.data.id !== previewRequestIdRef.current) return
      setPreviewResult({
        processedMarkdown: event.data.processedMarkdown,
        hasMath: event.data.hasMath,
      })
    }

    return () => {
      worker.terminate()
      if (previewWorkerRef.current === worker) {
        previewWorkerRef.current = null
      }
    }
  }, [mode])

  useEffect(() => {
    if (mode !== 'rendered') return

    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current)
    }

    const requestId = ++previewRequestIdRef.current
    previewTimerRef.current = setTimeout(() => {
      const worker = previewWorkerRef.current
      if (!worker) {
        setPreviewResult(preparePreviewMarkdown(value))
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
  }, [mode, value])

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

  // KaTeX 按需加载：检测文档是否包含数学公式
  const hasMath = previewResult.hasMath
  const [katexLib, setKatexLib] = useState<KatexModule | null>(null)
  useEffect(() => {
    if (hasMath && !katexLib) {
      loadKatex().then(setKatexLib)
    }
  }, [hasMath, katexLib])

  const components = useMemo(() => {
    return {
      p: (p: any) => <FoldableBlock tag="p" hideOnFold={true} {...p} />,
      h1: (p: any) => <FoldableBlock tag="h1" hideOnFold={false} {...p} />,
      h2: (p: any) => <FoldableBlock tag="h2" hideOnFold={true} {...p} />,
      h3: (p: any) => <FoldableBlock tag="h3" hideOnFold={true} {...p} />,
      h4: (p: any) => <FoldableBlock tag="h4" hideOnFold={true} {...p} />,
      h5: (p: any) => <FoldableBlock tag="h5" hideOnFold={true} {...p} />,
      h6: (p: any) => <FoldableBlock tag="h6" hideOnFold={true} {...p} />,
      ul: (p: any) => <FoldableBlock tag="ul" hideOnFold={true} {...p} />,
      ol: (p: any) => <FoldableBlock tag="ol" hideOnFold={true} {...p} />,
      li: (p: any) => <FoldableBlock tag="li" hideOnFold={true} {...p} />,
      blockquote: (p: any) => <FoldableBlock tag="blockquote" hideOnFold={true} {...p} />,
      div: (p: any) => <FoldableBlock tag="div" hideOnFold={true} {...p} />,
      span: ({ className, children, ...rest }: any) => <span className={className} {...rest}>{children}</span>,
      math: StableMath,
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
          {path => <MarkdownMedia {...innerProps} filePath={path} encodeMediaPath={encodeMediaPath} />}
        </FilePathContext.Consumer>
      ),
      pre: (p: any) => <FoldableBlock tag="pre" hideOnFold={true} {...p} />,
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
    const currentActive = activeLineEntryRef.current
    if (currentActive) {
      currentActive.entry.element.classList.remove('active-block')
      activeLineEntryRef.current = null
    }

    if (!container || mode !== 'rendered') {
      activeLineIndexRef.current = []
      return
    }

    const index = Array.from(container.querySelectorAll<HTMLElement>('[data-line-start]'))
      .map((element) => {
        const start = Number(element.dataset.lineStart)
        const end = Number(element.dataset.lineEnd ?? element.dataset.lineStart)
        if (Number.isNaN(start)) return null
        return {
          start,
          end: Number.isNaN(end) ? start : end,
          element,
        }
      })
      .filter((entry): entry is LineRangeIndexEntry => entry !== null)

    activeLineIndexRef.current = index
  }, [renderedValue, foldRegions, mode])

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

  // 高亮当前行逻辑
  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof activeLine !== 'number' || activeLine < 1) return

    const rafId = requestAnimationFrame(() => {
      const entries = activeLineIndexRef.current
      const current = activeLineEntryRef.current

      if (current && activeLine >= current.entry.start && activeLine <= current.entry.end) {
        return
      }

      const target = findActiveLineRangeEntry(entries, activeLine, current?.index ?? null)
      if (!target) {
        if (current) {
          current.entry.element.classList.remove('active-block')
          activeLineEntryRef.current = null
        }
        // 如果找不到目标元素（新增的最后一行还未渲染）
        const scrollParent = container.closest('.preview-body') as HTMLElement | null
        if (scrollParent) {
          // 判断是否在底部区域（滚动位置在最后 100px）
          const isNearBottom = scrollParent.scrollHeight - scrollParent.scrollTop - scrollParent.clientHeight < 100

          // 如果在底部，滚动到文档末尾
          if (isNearBottom) {
            scrollParent.scrollTo({ top: scrollParent.scrollHeight, behavior: 'smooth' })
          }
        }
        return
      }

      if (current && current.entry.element !== target.entry.element) {
        current.entry.element.classList.remove('active-block')
      }
      if (!target.entry.element.classList.contains('active-block')) {
        target.entry.element.classList.add('active-block')
      }
      activeLineEntryRef.current = target

      const scrollParent = container.closest('.preview-body') as HTMLElement | null
      if (!scrollParent) return

      const parentRect = scrollParent.getBoundingClientRect()
      const targetRect = target.entry.element.getBoundingClientRect()

      // 判断目标元素是否在可视区域内
      const isVisible =
        targetRect.top >= parentRect.top &&
        targetRect.bottom <= parentRect.bottom

      // 只在目标元素不可见时滚动
      if (!isVisible) {
        const currentBottomOffset = parentRect.height - (targetRect.bottom - parentRect.top)
        const desiredBottomOffset = parentRect.height / 4
        const delta = desiredBottomOffset - currentBottomOffset

        scrollParent.scrollTo({ top: scrollParent.scrollTop + delta })
      }
    })

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [activeLine, mode])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !onLineClick || mode !== 'rendered') return

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return

      // 避免点击超链接或交互控件时触发跳转编辑器
      if (target.closest('a, button, input, textarea')) return

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
        <KatexContext.Provider value={katexLib}>
        <div className="markdown-body gh-markdown" ref={containerRef} data-preview-width={previewWidth}>
          {mode === 'rendered' ? (
            <ReactMarkdown
              remarkPlugins={activeRemarkPlugins}
              remarkRehypeOptions={remarkRehypeOptions}
              rehypePlugins={[rehypeAlignedTabBlocks, rehypeRaw]}
              components={components}
            >
              {renderedValue}
            </ReactMarkdown>
          ) : (
            <pre className="markdown-source">
              <code>{value}</code>
            </pre>
          )}
        </div>
        </KatexContext.Provider>
      </FoldContext.Provider>
    </FilePathContext.Provider>
  )
}

export const MarkdownViewer = memo(
  MarkdownViewerComponent,
  (prev, next) => (
    prev.value === next.value &&
    prev.activeLine === next.activeLine &&
    prev.filePath === next.filePath &&
    prev.mode === next.mode &&
    prev.foldRegions === next.foldRegions
  ),
)
MarkdownViewer.displayName = 'MarkdownViewer'
