import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeHighlight from 'rehype-highlight'
import { remarkToc } from '../../../markdown/remarkToc'

// 自定义 pre 包装器：如果子内容是 mermaid，直接透传，避免双重 <pre>
function PreRenderer({ children, ...rest }: any) {
    const child = Array.isArray(children) ? children[0] : children
    if (child?.props?.className === 'mermaid') {
        return <>{children}</>
    }
    return <pre {...rest}>{children}</pre>
}

// 自定义 code 块：只处理 mermaid（输出为 Mermaid CDN 可识别的 <pre class="mermaid">）
// mind 块已在 preTreatMindBlocks 中替换为 SVG，不会到达这里
// 普通代码块由 rehype-highlight 添加 hljs class，这里仅透传
function CodeRenderer({ className, children, ...rest }: any) {
    const match = /language-(\w+)/.exec(className || '')
    const lang = match?.[1]

    if (lang === 'mermaid') {
        const code = String(children).trim()
        return <pre className="mermaid">{code}</pre>
    }

    return (
        <code className={className} {...rest}>
            {children}
        </code>
    )
}

// 导出 HTML 时的 img 渲染器：支持在 alt 文本尾部使用 (50%)/(240px) 指定宽度
function ExportImage(props: any) {
    const altText = props.alt || ''
    const widthMatch = /\(([^)]+)\)$/.exec(altText)
    const maxWidth = widthMatch ? widthMatch[1] : '100%'
    const cleanAlt = altText.replace(/\(([^)]+)\)$/, '').trim()
    const { src, ...rest } = props

    return (
        <img
            {...rest}
            src={src}
            alt={cleanAlt}
            style={{ maxWidth, height: 'auto', display: 'block', margin: '0 auto' }}
        />
    )
}

export function ExportWrapper({ markdown }: { markdown: string }) {
    return (
        <div className="markdown-body">
            <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath, remarkToc]}
                rehypePlugins={[
                    // 1. rehype-raw：允许内嵌原始 HTML（mind SVG div）直接透传
                    rehypeRaw,
                    // 2. rehype-highlight：为 <code class="language-*"> 添加 hljs 高亮 class
                    rehypeHighlight,
                    // 3. rehype-katex：渲染数学公式（须在 highlight 之后，避免公式被误高亮）
                    rehypeKatex,
                ]}
                components={{
                    code: CodeRenderer,
                    pre: PreRenderer,
                    img: ExportImage,
                }}
            >
                {markdown}
            </ReactMarkdown>
        </div>
    )
}

