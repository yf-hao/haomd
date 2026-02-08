import React, { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import 'katex/dist/katex.min.css'
import 'github-markdown-css/github-markdown.css'
import './MarkdownViewer.css'
import { getRenderer } from '../modules/markdown/plugins'
import { invoke } from '@tauri-apps/api/core'

export type Renderer = (code: string) => React.ReactNode

const remarkPlugins = [remarkGfm, remarkMath]
const rehypePlugins = [rehypeKatex] // 高亮由 SyntaxHighlighter 处理

const DiagramsLazy = React.lazy(() => import('./diagrams'))


function MarkdownViewerComponent(
  props: Readonly<{ value: string; activeLine?: number; previewWidth?: number }>
) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const { value, activeLine, previewWidth } = props

  const components = useMemo(() => {
    const blockWithAnchor = (Tag: keyof React.JSX.IntrinsicElements) => {
      return ({ node, children, className, ...rest }: any) => {
        const start = node?.position?.start?.line
        const end = node?.position?.end?.line ?? start
        const dataProps = start ? { 'data-line-start': start, 'data-line-end': end } : undefined
        return React.createElement(Tag, { className, ...dataProps, ...rest }, children)
      }
    }

    return {
      p: blockWithAnchor('p'),
      h1: blockWithAnchor('h1'),
      h2: blockWithAnchor('h2'),
      h3: blockWithAnchor('h3'),
      h4: blockWithAnchor('h4'),
      h5: blockWithAnchor('h5'),
      h6: blockWithAnchor('h6'),
      ul: blockWithAnchor('ul'),
      ol: blockWithAnchor('ol'),
      li: blockWithAnchor('li'),
      blockquote: blockWithAnchor('blockquote'),

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

      // 图片渲染器
      img: ({ node, ...props }: any) => {
        // 解析 alt 末尾的 (30%) / (300px) / (20rem)
        const altText = props.alt || ''

        const widthMatch = /\(([\d.]+(?:px|%|rem|vw))\)$/.exec(altText)
        const maxWidth = widthMatch ? widthMatch[1] : '100%'

        // 从 alt 文本中移除宽度标记
        const cleanAlt = altText.replace(/\(([\d.]+(?:px|%|rem|vw))\)$/, '').trim()

        return (
          <img
            {...props}
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
        const start = node?.position?.start?.line
        const end = node?.position?.end?.line ?? start
        const dataProps = start
          ? { 'data-line-start': start, 'data-line-end': end }
          : undefined

        const parentIsPre =
          node?.parent?.type === 'element' &&
          node.parent.tagName === 'pre'

        const classNames = []
        if (!parentIsPre) classNames.push('code-block')

        return (
          <pre className={classNames.join(' ')} {...dataProps} {...rest}>
            {children}
          </pre>
        )
      },

      // code 渲染器
      code({ inline, className, children, node, ...rest }: any) {
        const content = String(children).trim()
        const match = /language-([\w]+)/.exec(className || '')
        const lang = match?.[1]

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
  }, [])

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

  return (
    <div className="markdown-body gh-markdown" ref={containerRef} data-preview-width={previewWidth}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {value}
      </ReactMarkdown>
    </div>
  )
}

export const MarkdownViewer = memo(MarkdownViewerComponent)
MarkdownViewer.displayName = 'MarkdownViewer'
