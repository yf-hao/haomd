import React, { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
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
}

type LineRange = {
  start?: number
  end?: number
}

const LineRangeContext = React.createContext<LineRange | undefined>(undefined)

const useLineRange = () => React.useContext(LineRangeContext)

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


function MarkdownViewerComponent(
  props: Readonly<MarkdownViewerProps>
) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const { value, activeLine, previewWidth, filePath, foldRegions, mode = 'rendered', onLineClick } = props

  const components = useMemo(() => {
    const regions = foldRegions ?? []

    // 判断一个块 [start, end] 是否与任一折叠区间有重叠
    const isBlockFolded = (start?: number, end?: number): boolean => {
      if (!regions.length || !start) return false
      const s = start
      const e = end ?? start
      return regions.some((r) => !(e < r.fromLine || s > r.toLine))
    }

    const blockWithAnchor = (Tag: keyof React.JSX.IntrinsicElements, hideOnFold: boolean) => {
      return ({ node, children, className, ...rest }: any) => {
        const start = node?.position?.start?.line as number | undefined
        const end = (node?.position?.end?.line ?? start) as number | undefined

        if (hideOnFold && isBlockFolded(start, end)) {
          return null
        }

        const dataProps = start
          ? { 'data-line-start': start, 'data-line-end': end }
          : undefined

        const lineRange: LineRange = { start, end }

        return (
          <LineRangeContext.Provider value={lineRange}>
            {React.createElement(Tag, { className, ...dataProps, ...rest }, children)}
          </LineRangeContext.Provider>
        )
      }
    }

    return {
      // 文本块：若起始行位于折叠区间内，则在预览中隐藏
      p: blockWithAnchor('p', true),
      // 一级标题：作为折叠入口本身不隐藏（其所在行通常不在折叠区间内）
      h1: blockWithAnchor('h1', false),
      // 二级及以下标题：如果所在行在折叠区间内（例如属于某个 H1/H2 的折叠内容），则隐藏
      h2: blockWithAnchor('h2', true),
      h3: blockWithAnchor('h3', true),
      h4: blockWithAnchor('h4', true),
      h5: blockWithAnchor('h5', true),
      h6: blockWithAnchor('h6', true),
      ul: blockWithAnchor('ul', true),
      ol: blockWithAnchor('ol', true),
      li: blockWithAnchor('li', true),
      blockquote: blockWithAnchor('blockquote', true),
      div: blockWithAnchor('div', true),

      // 通用 span：不再承担 KaTeX 折叠职责，由 math/inlineMath 专门处理
      span: ({ className, children, ...rest }: any) => (
        <span className={className} {...rest}>
          {children}
        </span>
      ),

      // 块级 KaTeX 公式：直接在 React 层渲染，并参与折叠与高亮
      math: ({ node, value, ...rest }: any) => {
        const start = node?.position?.start?.line as number | undefined
        const end = (node?.position?.end?.line ?? start) as number | undefined

        if (isBlockFolded(start, end)) {
          return null
        }

        const tex = (value ?? (node as any).value ?? '').trim()
        let html = ''
        try {
          html = katex.renderToString(tex, { displayMode: true, throwOnError: false })
        } catch {
          html = tex
        }

        const dataProps = start
          ? { 'data-line-start': start, 'data-line-end': end }
          : undefined

        const lineRange: LineRange = { start, end }

        return (
          <LineRangeContext.Provider value={lineRange}>
            <div
              {...rest}
              {...dataProps}
              // KaTeX 已经返回完整的 HTML 结构（含 .katex-display/.katex 等），这里仅包一层用于行号锚点
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </LineRangeContext.Provider>
        )
      },

      // 行内 KaTeX 公式：使用父块的行号参与折叠
      inlineMath: ({ node, value, ...rest }: any) => {
        const lineRange = useLineRange()
        let start = lineRange?.start
        let end = lineRange?.end ?? start

        if (start == null) {
          const pos = node?.position
          start = pos?.start?.line as number | undefined
          end = (pos?.end?.line ?? start) as number | undefined
        }

        if (isBlockFolded(start, end)) {
          return null
        }

        const tex = (value ?? (node as any).value ?? '').trim()
        let html = ''
        try {
          html = katex.renderToString(tex, { displayMode: false, throwOnError: false })
        } catch {
          html = tex
        }

        return (
          <span
            {...rest}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )
      },

      // 自定义链接渲染：在应用内新建浏览器窗口
      a: ({ node, href, children, ...props }: any) => {
        const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
          e.preventDefault()
          if (!href) return
          void invoke('open_webview_browser', { url: href })
        }

        return (
          <a
            href={href}
            onClick={handleClick}
            target="_blank"
            rel="noreferrer"
            {...props}
          >
            {children}
          </a>
        )
      },

      // 图片 / 音频渲染器
      img: ({ node, ...props }: any) => {
        // 解析 alt 末尾的 (30%) / (300px) / (20rem)
        const altText = props.alt || ''

        const widthMatch = /\(([\d.]+(?:px|%|rem|vw))\)$/.exec(altText)
        const maxWidth = widthMatch ? widthMatch[1] : '100%'

        // 从 alt 文本中移除宽度标记
        const cleanAlt = altText.replace(/\(([\d.]+(?:px|%|rem|vw))\)$/, '').trim()

        // 处理相对路径：如果 src 是相对路径且知道当前文件路径，则转换为 haomd:// 协议的绝对地址
        const src = props.src || ''
        let finalSrc = src

        if (filePath && src && !src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('data:')) {
          const fileDir = filePath.replace(/[/\\][^/\\]+$/, '')
          const sep = filePath.includes('\\') ? '\\' : '/'

          // 先算出资源的绝对路径
          let absPath = src
          if (src.startsWith('.')) {
            // 处理 ./ ../ 等相对路径
            const parts = src.split(/[\/\\]/)
            let dir = fileDir
            for (const part of parts) {
              if (part === '..') {
                dir = dir.replace(/[/\\][^/\\]+$/, '')
              } else if (part !== '.') {
                dir = dir + sep + part
              }
            }
            absPath = dir
          } else if (!src.match(/^[a-zA-Z]:/)) {
            // 不是绝对路径，拼接当前文件目录
            absPath = fileDir + sep + src
          }

          // 根据平台生成正确的自定义协议 URL
          // Windows: https://haomd.localhost/绝对路径
          // macOS/Linux: haomd://localhost/绝对路径
          // 使用 encodeURIComponent 对每个路径组件进行编码，以支持中文文件名
          const pathParts = absPath.split(/([/\\])/)
          const encodedParts = pathParts.map((part: string) => {
            // 保留分隔符不编码
            if (part === '/' || part === '\\') return part
            // 对路径组件进行编码
            return encodeURIComponent(part)
          })
          const encoded = encodedParts.join('')
          const isWindows = filePath.includes('\\') || navigator.userAgent.includes('Windows')
          if (isWindows) {
            finalSrc = `https://haomd.localhost${encoded}`
          } else {
            finalSrc = `haomd://localhost${encoded}`
          }
        }

        const lowerAlt = cleanAlt.toLowerCase()
        const isAudioByAlt = lowerAlt === 'audio' || lowerAlt === '音频'
        const isAudioByExt = /\.(mp3|wav|m4a|ogg|flac)$/i.test(src)
        const isAudio = isAudioByAlt || isAudioByExt

        if (isAudio) {
          return (
            <audio controls src={finalSrc} style={{ width: '100%' }}>
              您的浏览器不支持 audio 标签。
            </audio>
          )
        }

        // 视频支持
        const isVideoByAlt = lowerAlt === 'video' || lowerAlt === '视频'
        const isVideoByExt = /\.(mp4|webm|mov|ogg|ogv)$/i.test(src)
        const isVideo = isVideoByAlt || isVideoByExt

        if (isVideo) {
          // 解析 alt 中的 poster 路径：video|poster.png
          const parts = cleanAlt.split('|')
          const posterAlt = parts[1]?.trim()
          let posterUrl = ''

          if (posterAlt) {
            // 处理 poster 图片路径（复用路径转换逻辑）
            let posterSrc = posterAlt
            if (filePath && posterSrc && !posterSrc.startsWith('http://') && !posterSrc.startsWith('https://') && !posterSrc.startsWith('data:')) {
              const fileDir = filePath.replace(/[/\\][^/\\]+$/, '')
              const sep = filePath.includes('\\') ? '\\' : '/'

              let absPath = posterSrc
              if (posterSrc.startsWith('.')) {
                const parts = posterSrc.split(/[\/\\]/)
                let dir = fileDir
                for (const part of parts) {
                  if (part === '..') {
                    dir = dir.replace(/[/\\][^/\\]+$/, '')
                  } else if (part !== '.') {
                    dir = dir + sep + part
                  }
                }
                absPath = dir
              } else if (!posterSrc.match(/^[a-zA-Z]:/)) {
                absPath = fileDir + sep + posterSrc
              }

              const pathParts = absPath.split(/([/\\])/)
              const encodedParts = pathParts.map((part: string) => {
                if (part === '/' || part === '\\') return part
                return encodeURIComponent(part)
              })
              const encoded = encodedParts.join('')
              const isWindows = filePath.includes('\\') || navigator.userAgent.includes('Windows')
              posterUrl = isWindows ? `https://haomd.localhost${encoded}` : `haomd://localhost${encoded}`
            } else {
              posterUrl = posterSrc
            }
          }

          return (
            <video controls preload="metadata" poster={posterUrl || undefined} src={finalSrc} style={{ maxWidth: '100%', height: 'auto' }}>
              您的浏览器不支持 video 标签。
            </video>
          )
        }

        return (
          <img
            {...props}
            src={finalSrc}
            loading="lazy"
            alt={cleanAlt}
            style={{
              maxWidth,
              height: 'auto',
              display: 'block',
              margin: '0 auto',
            }}
          />
        )
      },

      // pre 渲染器
      pre: ({ node, children, className, ...rest }: any) => {
        const start = node?.position?.start?.line as number | undefined
        const end = (node?.position?.end?.line ?? start) as number | undefined

        if (isBlockFolded(start, end)) {
          return null
        }

        const dataProps = start
          ? { 'data-line-start': start, 'data-line-end': end }
          : undefined

        const parentIsPre =
          node?.parent?.type === 'element' &&
          node.parent.tagName === 'pre'

        const classNames = []
        if (!parentIsPre) classNames.push('code-block')

        const lineRange: LineRange = { start, end }

        return (
          <LineRangeContext.Provider value={lineRange}>
            <pre className={classNames.join(' ')} {...dataProps} {...rest}>
              {children}
            </pre>
          </LineRangeContext.Provider>
        )
      },

      // code 渲染器
      code({ inline, className, children, node, ...rest }: any) {
        const content = String(children).trim()
        const match = /language-([\w]+)/.exec(className || '')
        const lang = match?.[1]

        // 对块级 code，根据行号区间折叠对应内容（行内 code 按父块处理即可）
        const start = (node as any)?.position?.start?.line as number | undefined
        const end = (node as any)?.position?.end?.line ?? start
        if (!inline && isBlockFolded(start, end)) {
          return null
        }

        // // 行内 code
        // if (inline) {
        //   return (
        //     <code className="inline-code" {...rest}>
        //       {children}
        //     </code>
        //   )
        // }

        // 块级代码处理
        const isMultiline = content.includes('\n')

        // 优先使用自定义 renderer
        if (lang) {
          const renderer = getRenderer(lang)
          if (renderer) return renderer(content)

          if (lang === 'mermaid' || lang === 'mind') {
            return (
              <React.Suspense fallback={<pre>图表加载中…</pre>}>
                <DiagramsLazy lang={lang} code={content} />
              </React.Suspense>
            )
          }

          // 使用 SyntaxHighlighter 渲染并显示行号
          return (
            <SyntaxHighlighter
              language={lang}
              style={oneDark}
              showLineNumbers
              wrapLines
              {...rest}
            >
              {content}
            </SyntaxHighlighter>
          )
        }

        // 单行无语言 → 行内 code
        if (!isMultiline) {
          return (
            <code className="code" {...rest}>
              {content}
            </code>
          )
        }

        // 多行无语言 → 普通 pre/code
        return (
          <pre {...rest}>
            <code className="plain">{content}</code>
          </pre>
        )
      },
    }
  }, [foldRegions])

  // 保存和恢复滚动位置
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    // 保存当前滚动位置和是否在底部
    const scrollParent = container.closest('.preview-body') as HTMLElement | null
    if (!scrollParent) return

    const savedScrollTop = scrollParent.scrollTop
    const wasNearBottom = scrollParent.scrollHeight - scrollParent.scrollTop - scrollParent.clientHeight < 100

    // 立即恢复滚动位置（在 DOM 更新后、浏览器绘制前）
    // 用户看不到跳转，因为浏览器还未绘制
    if (wasNearBottom) {
      scrollParent.scrollTop = scrollParent.scrollHeight
    } else {
      scrollParent.scrollTop = savedScrollTop
    }
  }, [value])

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

  return (
    <div className="markdown-body gh-markdown" ref={containerRef} data-preview-width={previewWidth}>
      {mode === 'rendered' ? (
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          remarkRehypeOptions={remarkRehypeOptions}
          components={components}
        >
          {value}
        </ReactMarkdown>
      ) : (
        <pre className="markdown-source">
          <code>{value}</code>
        </pre>
      )}
    </div>
  )
}

export const MarkdownViewer = memo(MarkdownViewerComponent)
MarkdownViewer.displayName = 'MarkdownViewer'
