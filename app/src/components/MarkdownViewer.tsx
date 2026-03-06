import React, { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeRaw from 'rehype-raw'
import katex from 'katex'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import 'katex/dist/katex.min.css'
import 'github-markdown-css/github-markdown.css'
import './MarkdownViewer.css'
import { getRenderer } from '../modules/markdown/plugins'
import { invoke } from '@tauri-apps/api/core'

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

type LineRange = {
  start?: number
  end?: number
}

const LineRangeContext = React.createContext<LineRange | undefined>(undefined)
const FoldContext = React.createContext<FoldRegion[]>([])
const FilePathContext = React.createContext<string | null>(null)

const useLineRange = () => React.useContext(LineRangeContext)
const useFoldRegions = () => React.useContext(FoldContext)

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

const remarkPlugins = [remarkGfm, remarkMath, remarkMathLineAnchors]

// 预览虚拟化开关：关闭时走浏览器原生滚动，体验更稳定
const ENABLE_PREVIEW_VIRTUALIZATION = false

// KaTeX 渲染结果缓存，按内容去重
const blockMathHtmlCache = new Map<string, string>()
const inlineMathHtmlCache = new Map<string, string>()

function renderBlockMathHtml(tex: string): string {
  const key = tex
  const cached = blockMathHtmlCache.get(key)
  if (cached) return cached
  let html = ''
  try {
    html = katex.renderToString(tex, { displayMode: true, throwOnError: false })
  } catch {
    html = tex
  }
  blockMathHtmlCache.set(key, html)
  return html
}

function renderInlineMathHtml(tex: string): string {
  const key = tex
  const cached = inlineMathHtmlCache.get(key)
  if (cached) return cached
  let html = ''
  try {
    html = katex.renderToString(tex, { displayMode: false, throwOnError: false })
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

type CodeBlockProps = React.ComponentProps<typeof SyntaxHighlighter> & {
  lang?: string
  content: string
}

// 提取稳定的媒体组件，避免受 foldRegions 变动影响导致视频重刷
const MarkdownMedia = memo(({ node, filePath, encodeMediaPath, ...props }: any) => {
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

  const lowerAlt = cleanAlt.toLowerCase()
  const isAudio = lowerAlt === 'audio' || lowerAlt === '音频' || /\.(mp3|wav|m4a|ogg|flac)$/i.test(src)

  if (isAudio) {
    return <audio controls src={finalSrc} style={{ width: '100%' }}>您的浏览器不支持 audio 标签。</audio>
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
    return <video controls preload="metadata" poster={posterUrl || undefined} src={finalSrc} style={{ maxWidth: '100%', height: 'auto' }}>您的浏览器不支持 video 标签。</video>
  }

  return <img {...props} src={finalSrc} loading="lazy" alt={cleanAlt} style={{ maxWidth, height: 'auto', display: 'block', margin: '0 auto' }} />
})

const DiagramBlock = memo(
  ({ lang, code }: DiagramBlockProps) => (
    <React.Suspense fallback={<pre>图表加载中…</pre>}>
      <DiagramsLazy lang={lang} code={code} />
    </React.Suspense>
  ),
  (prev, next) => prev.lang === next.lang && prev.code === next.code,
)

const CodeBlock = memo(
  ({ lang, content, ...rest }: CodeBlockProps) => (
    <SyntaxHighlighter
      language={lang}
      style={oneDark}
      showLineNumbers
      wrapLines
      {...rest}
    >
      {content}
    </SyntaxHighlighter>
  ),
  (prev, next) =>
    prev.lang === next.lang &&
    prev.content === next.content &&
    prev.className === next.className,
)

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
    return <CodeBlock lang={lang} content={content} {...rest} />
  }

  const isMultiline = content.includes('\n')
  if (!isMultiline) return <code className="code" {...rest}>{content}</code>
  return <pre {...rest}><code className="plain">{content}</code></pre>
})

const StableMath = memo(({ node, value, ...rest }: any) => {
  const regions = useFoldRegions()
  const start = node?.position?.start?.line as number | undefined
  const end = (node?.position?.end?.line ?? start) as number | undefined

  if (isBlockFolded(regions, start, end)) return null

  const tex = (value ?? (node as any).value ?? '').trim()
  const html = renderBlockMathHtml(tex)
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
  const html = renderInlineMathHtml(tex)

  return <span {...rest} dangerouslySetInnerHTML={{ __html: html }} />
})

type BlockMetric = {
  el: HTMLElement
  top: number
  height: number
  startLine: number
  endLine: number
}

function MarkdownViewerComponent(
  props: Readonly<MarkdownViewerProps>
) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const topSpacerRef = useRef<HTMLDivElement | null>(null)
  const bottomSpacerRef = useRef<HTMLDivElement | null>(null)
  const blocksRef = useRef<BlockMetric[]>([])
  const [virtualize, setVirtualize] = React.useState(false)

  const { value, activeLine, previewWidth, filePath, foldRegions, mode = 'rendered', onLineClick, onSelectionChange } = props

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
      inlineMath: StableInlineMath,
      a: ({ node, href, children, ...props }: any) => {
        const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
          e.preventDefault()
          if (!href) return
          void invoke('open_webview_browser', { url: href })
        }
        return <a href={href} onClick={handleClick} target="_blank" rel="noreferrer" {...props}>{children}</a>
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
  }, [value])

  // 基于 DOM 的简单虚拟化：只让视口附近的块参与布局，其余用占位高度代替
  useLayoutEffect(() => {
    if (!ENABLE_PREVIEW_VIRTUALIZATION) return

    const container = containerRef.current
    if (!container) return

    const scrollParent = container.closest('.preview-body') as HTMLElement | null
    if (!scrollParent) return

    const anchors = Array.from(
      container.querySelectorAll<HTMLElement>('[data-line-start]')
    )

    // 小文档不启用虚拟化，保留原有行为
    if (anchors.length < 400) {
      blocksRef.current = []
      React.startTransition(() => setVirtualize(false))
      anchors.forEach((el) => {
        el.style.display = ''
      })
      if (topSpacerRef.current) topSpacerRef.current.style.height = '0px'
      if (bottomSpacerRef.current) bottomSpacerRef.current.style.height = '0px'
      return
    }

    const parentTop = scrollParent.getBoundingClientRect().top
    const metrics: BlockMetric[] = anchors.map((el) => {
      const rect = el.getBoundingClientRect()
      const start = Number(el.dataset.lineStart)
      const endRaw = el.dataset.lineEnd ?? el.dataset.lineStart
      const end = typeof endRaw === 'string' ? Number(endRaw) : Number(el.dataset.lineStart)
      const safeStart = Number.isNaN(start) ? 0 : start
      const safeEnd = Number.isNaN(end) ? safeStart : end
      return {
        el,
        top: rect.top - parentTop + scrollParent.scrollTop,
        height: rect.height || 0,
        startLine: safeStart,
        endLine: safeEnd,
      }
    })

    blocksRef.current = metrics
    React.startTransition(() => setVirtualize(true))
  }, [value, filePath, foldRegions])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const scrollParent = container.closest('.preview-body') as HTMLElement | null
    if (!scrollParent) return

    // 非虚拟化模式：确保所有块可见、占位高度为 0
    if (!virtualize) {
      const anchors = Array.from(
        container.querySelectorAll<HTMLElement>('[data-line-start]')
      )
      anchors.forEach((el) => {
        el.style.display = ''
      })
      if (topSpacerRef.current) topSpacerRef.current.style.height = '0px'
      if (bottomSpacerRef.current) bottomSpacerRef.current.style.height = '0px'
      return
    }

    const applyVirtualWindow = () => {
      const blocks = blocksRef.current
      if (!blocks.length) return

      const top = scrollParent.scrollTop
      const vh = scrollParent.clientHeight
      const buffer = vh * 1.0

      const windowStart = top - buffer
      const windowEnd = top + vh + buffer

      let from = 0
      let to = blocks.length - 1

      while (from < blocks.length && (blocks[from].top + blocks[from].height) < windowStart) {
        from += 1
      }
      while (to >= 0 && blocks[to].top > windowEnd) {
        to -= 1
      }

      if (from < 0) from = 0
      if (to < from) to = from

      // 确保包含 activeLine 的块始终在可见窗口内，避免同步滚动时目标块被隐藏
      if (typeof activeLine === 'number' && activeLine > 0) {
        let activeIndex = -1
        for (let i = 0; i < blocks.length; i += 1) {
          const b = blocks[i]
          const start = b.startLine
          const end = b.endLine || b.startLine
          if (activeLine >= start && activeLine <= end) {
            activeIndex = i
            break
          }
        }
        if (activeIndex !== -1) {
          if (activeIndex < from) from = activeIndex
          if (activeIndex > to) to = activeIndex
        }
      }

      let topHidden = 0
      for (let i = 0; i < from; i += 1) {
        topHidden += blocks[i].height
      }
      let bottomHidden = 0
      for (let i = to + 1; i < blocks.length; i += 1) {
        bottomHidden += blocks[i].height
      }

      if (topSpacerRef.current) topSpacerRef.current.style.height = `${topHidden}px`
      if (bottomSpacerRef.current) bottomSpacerRef.current.style.height = `${bottomHidden}px`

      blocks.forEach((b, index) => {
        const inRange = index >= from && index <= to
        b.el.style.display = inRange ? '' : 'none'
      })
    }

    applyVirtualWindow()

    const handleScroll = () => {
      applyVirtualWindow()
    }

    scrollParent.addEventListener('scroll', handleScroll)
    return () => {
      scrollParent.removeEventListener('scroll', handleScroll)
    }
  }, [virtualize, activeLine])

  // 高亮当前行逻辑
  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof activeLine !== 'number' || activeLine < 1) return

    const rafId = requestAnimationFrame(() => {
      const anchors = Array.from(
        container.querySelectorAll<HTMLElement>('[data-line-start]')
      )
      const target = anchors.find((el) => {
        const start = Number(el.dataset.lineStart)
        const end = Number(el.dataset.lineEnd ?? el.dataset.lineStart)
        if (Number.isNaN(start)) return false
        return activeLine >= start && activeLine <= (Number.isNaN(end) ? start : end)
      })

      anchors.forEach((el) => el.classList.remove('active-block'))
      if (!target) {
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

      target.classList.add('active-block')

      const scrollParent = container.closest('.preview-body') as HTMLElement | null
      if (!scrollParent) return

      const parentRect = scrollParent.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()

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
  }, [activeLine])

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
        <div className="markdown-body gh-markdown" ref={containerRef} data-preview-width={previewWidth}>
          <div ref={topSpacerRef} aria-hidden="true" />
          {mode === 'rendered' ? (
            <ReactMarkdown
              remarkPlugins={remarkPlugins}
              remarkRehypeOptions={remarkRehypeOptions}
              rehypePlugins={[rehypeRaw]}
              components={components}
            >
              {value}
            </ReactMarkdown>
          ) : (
            <pre className="markdown-source">
              <code>{value}</code>
            </pre>
          )}
          <div ref={bottomSpacerRef} aria-hidden="true" />
        </div>
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
