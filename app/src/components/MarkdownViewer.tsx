import React, { memo, useEffect, useMemo, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import 'github-markdown-css/github-markdown.css'
import { MermaidBlock, XMindBlock } from './diagrams'
import { getRenderer, registerRenderer } from '../modules/markdown/plugins'

export type Renderer = (code: string) => React.ReactNode

const remarkPlugins = [remarkGfm, remarkMath]
const rehypePlugins = [rehypeKatex, rehypeHighlight]

// 默认注册内置 renderer（避免重复注册）
const ensureDefaultRenderers = () => {
  if (!getRenderer('mermaid')) {
    registerRenderer('mermaid', (code) => <MermaidBlock code={code} />)
  }
  if (!getRenderer('xmind')) {
    registerRenderer('xmind', (code) => <XMindBlock code={code} />)
  }
}

ensureDefaultRenderers()

function MarkdownViewerComponent(props: Readonly<{ value: string; activeLine?: number }>) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const { value, activeLine } = props

  const components = useMemo(() => {
    const blockWithAnchor = (Tag: keyof React.JSX.IntrinsicElements) => {
      const BlockComponent = ({ node, children, className, ...rest }: any) => {
        const start = node?.position?.start?.line
        const end = node?.position?.end?.line ?? start
        const dataProps = start
          ? { 'data-line-start': start, 'data-line-end': end ?? start }
          : undefined
        return React.createElement(Tag, { className, ...dataProps, ...rest }, children)
      }
      return BlockComponent
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
      pre: blockWithAnchor('pre'),
      code({ inline, className, children, node, ...rest }: any) {
        const match = /language-(\w+)/.exec(className || '')
        const lang = match?.[1]
        const content = String(children).trim()
        const start = node?.position?.start?.line
        const end = node?.position?.end?.line ?? start
        const dataProps = start
          ? { 'data-line-start': start, 'data-line-end': end ?? start }
          : undefined

        if (!inline && lang) {
          const renderer = getRenderer(lang)
          if (renderer) return renderer(content)
          if (lang === 'mermaid') return <MermaidBlock code={content} />
          if (lang === 'xmind') return <XMindBlock code={content} />
        }

        if (!inline && lang) {
          const renderer = getRenderer(lang)
          if (renderer) return renderer(content)
          if (lang === 'mermaid') return <MermaidBlock code={content} />
          if (lang === 'xmind') return <XMindBlock code={content} />
        }

        if (!inline) {
          return (
            <pre className={`code-block ${className || ''}`.trim()} {...dataProps} {...rest}>
              <code>{content}</code>
            </pre>
          )
        }

        // inline code: 始终作为行内代码渲染，不占整行
        return (
          <code className={className} {...rest} {...dataProps}>
            {children}
          </code>
        )
      },
    }
  }, [])


  const lastAnchoredLine = useRef<number | null>(null)

  useEffect(() => {
    if (!containerRef.current || typeof activeLine !== 'number') return
    const rafId = requestAnimationFrame(() => {
      const anchors = Array.from(
        containerRef.current?.querySelectorAll<HTMLElement>('[data-line-start]') ?? [],
      )
      const target = anchors.find((el) => {
        const start = Number(el.dataset.lineStart)
        const end = Number(el.dataset.lineEnd ?? el.dataset.lineStart)
        if (Number.isNaN(start)) return false
        return activeLine >= start && activeLine <= (Number.isNaN(end) ? start : end)
      })

      anchors.forEach((el) => el.classList.remove('active-block'))

      if (!target) return
      target.classList.add('active-block')

      const startLine = Number(target.dataset.lineStart)
      if (lastAnchoredLine.current === startLine) return
      lastAnchoredLine.current = startLine

      const scrollParent = containerRef.current?.closest('.preview-body') as HTMLElement | null
      if (!scrollParent) return

      const parentRect = scrollParent.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      const offsetTop = targetRect.top - parentRect.top
      const delta = offsetTop - parentRect.height / 2 + targetRect.height / 2
      scrollParent.scrollTo({ top: scrollParent.scrollTop + delta })
    })
    return () => {
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [activeLine])

  return (
    <div className="markdown-body gh-markdown" ref={containerRef}>
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
