import React, { memo, useEffect, useMemo, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import 'github-markdown-css/github-markdown.css'
import { MermaidBlock, XMindBlock } from './diagrams'
import { getRenderer, registerRenderer } from '../modules/markdown/plugins'

export type Renderer = (code: string) => React.ReactNode

const remarkPlugins = [remarkGfm, remarkMath]
const rehypePlugins = [rehypeKatex] // 高亮由 SyntaxHighlighter 处理

// 注册内置 renderer
const ensureDefaultRenderers = () => {
  if (!getRenderer('mermaid')) {
    registerRenderer('mermaid', (code) => <MermaidBlock code={code} />)
  }
  if (!getRenderer('mind')) {
    registerRenderer('mind', (code) => <XMindBlock code={code} />)
  }
}
ensureDefaultRenderers()

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
        const match = /language-(\w+)/.exec(className || '')
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
          if (lang === 'mermaid') return <MermaidBlock code={content} />
          if (lang === 'mind') return <XMindBlock code={content} />

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

  // 高亮当前行逻辑
  useEffect(() => {
    if (!containerRef.current || typeof activeLine !== 'number') return
    const rafId = requestAnimationFrame(() => {
      const anchors = Array.from(
        containerRef.current.querySelectorAll<HTMLElement>('[data-line-start]')
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

      const scrollParent = containerRef.current.closest('.preview-body') as HTMLElement | null
      if (!scrollParent) return

      const parentRect = scrollParent.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      const currentBottomOffset = parentRect.height - (targetRect.bottom - parentRect.top)
      const desiredBottomOffset = parentRect.height / 4
      const delta = desiredBottomOffset - currentBottomOffset

      scrollParent.scrollTo({ top: scrollParent.scrollTop + delta })
    })
    return () => {
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [activeLine, value])

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
