import { memo, useEffect, useMemo, useRef, useState } from 'react'
import mermaid from 'mermaid'
import MindElixir, { SIDE } from 'mind-elixir'
import 'mind-elixir/style'
import { mermaidConfig } from '../config/renderers'

mermaid.initialize({
  startOnLoad: false,
  securityLevel: mermaidConfig.securityLevel,
  theme: mermaidConfig.theme,
  fontFamily: mermaidConfig.fontFamily,
})

const mermaidCache = new Map<string, string>()
const mindCache = new Map<string, MindElixirData>()

export const MermaidBlock = memo(function MermaidBlock({ code }: Readonly<{ code: string }>) {
  const [svg, setSvg] = useState<string>('加载中…')
  const [error, setError] = useState<string | null>(null)
  const idRef = useRef(`mermaid-${Math.random().toString(36).slice(2)}`)
  const runIdRef = useRef(0)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerWidth, setContainerWidth] = useState<number | null>(null)

  const cacheKey = useMemo(() => {
    const width = containerWidth ?? 0
    return `${code}__w:${Math.round(width)}`
  }, [code, containerWidth])

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width ?? 0
      setContainerWidth((prev) => {
        const next = Math.round(w)
        return prev === next ? prev : next
      })
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (containerWidth === null) return
    if (mermaidCache.has(cacheKey)) {
      setError(null)
      setSvg(mermaidCache.get(cacheKey) || '')
      return
    }

    let cancelled = false
    const currentRun = ++runIdRef.current
    setError(null)
    setSvg('加载中…')

    const timer = window.setTimeout(() => {
      mermaid
        .render(idRef.current, code)
        .then(({ svg: rendered }) => {
          if (cancelled || currentRun !== runIdRef.current) return
          mermaidCache.set(cacheKey, rendered)
          setSvg(rendered)
        })
        .catch((err) => {
          if (cancelled || currentRun !== runIdRef.current) return
          setError(err?.message ?? 'Mermaid 渲染失败')
        })
    }, 200)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [cacheKey, code, containerWidth])

  return (
    <div className="diagram-block" ref={containerRef}>
      {error ? (
        <div className="diagram-error">{error}</div>
      ) : (
        <div
          className="diagram-canvas mermaid-center"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </div>
  )
})

type MindNode = {
  title: string
  children?: MindNode[]
}

type MindElixirData = {
  nodeData: {
    id: string
    topic: string
    children?: MindElixirData['nodeData'][]
  }
  direction?: 0 | 1 | 2
}

function hashString(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0
  }
  return hash.toString(16)
}

function toMindElixirData(root: MindNode): MindElixirData {
  let counter = 0
  const genId = () => `m-${Date.now().toString(36)}-${counter++}`
  const walk = (node: MindNode): MindElixirData['nodeData'] => ({
    id: genId(),
    topic: node.title,
    children: node.children?.map(walk),
  })
  return {
    nodeData: walk(root),
    direction: SIDE,
  }
}

function parseOutline(text: string): MindNode | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0)
  if (!lines.length) return null

  type StackItem = { depth: number; node: MindNode }
  const rootLine = lines[0].replace(/^[-*+\s]+/, '').trim()
  if (!rootLine) return null
  const root: MindNode = { title: rootLine, children: [] }
  const stack: StackItem[] = [{ depth: 0, node: root }]

  const getDepth = (line: string) => {
    const leadingTabs = line.match(/^\t+/)?.[0].length ?? 0
    const leadingSpaces = line.match(/^ +/)?.[0].length ?? 0
    const hyphenPrefix = line.match(/^(-|--|\*|\+)+/)?.[0] ?? ''
    const hyphenDepth = hyphenPrefix ? hyphenPrefix.replace(/[^-]/g, '').length : 0
    return leadingTabs + Math.floor(leadingSpaces / 2) + hyphenDepth
  }

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]
    const depth = getDepth(raw)
    const title = raw.replace(/^[-*+\s]+/, '').trim()
    if (!title) continue

    const node: MindNode = { title, children: [] }
    while (stack.length && stack[stack.length - 1].depth >= depth) {
      stack.pop()
    }
    const parent = stack[stack.length - 1]?.node
    if (!parent) return null
    parent.children = parent.children || []
    parent.children.push(node)
    stack.push({ depth, node })
  }

  return root
}

export function XMindBlock({ code }: Readonly<{ code: string }>) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mindRef = useRef<any>(null)
  const lastHashRef = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const codeHash = useMemo(() => hashString(code), [code])

  const data = useMemo(() => {
    if (mindCache.has(codeHash)) return mindCache.get(codeHash)!
    try {
      const parsed = JSON.parse(code) as MindNode
      if (!parsed || typeof parsed !== 'object' || typeof (parsed as any).title !== 'string') {
        throw new Error('需提供 { title, children } 结构的 JSON')
      }
      const result = toMindElixirData(parsed)
      mindCache.set(codeHash, result)
      return result
    } catch (_) {
      const outline = parseOutline(code)
      if (outline) {
        const result = toMindElixirData(outline)
        mindCache.set(codeHash, result)
        setError(null)
        return result
      }
      const msg = 'JSON 解析失败，且大纲格式不合法（请检查缩进或前缀）'
      setError(msg)
      return null
    }
  }, [code, codeHash])

  useEffect(() => {
    if (!containerRef.current || !data || error) return
    if (lastHashRef.current === codeHash) return

    const el = containerRef.current
    el.innerHTML = ''

    const init = () => {
      try {
        if (mindRef.current) {
          try {
            mindRef.current.destroy?.()
          } catch (e) {
            console.warn('Mind-elixir destroy failed', e)
          }
          mindRef.current = null
        }

        const mind = new MindElixir({
          el,
          direction: data.direction ?? SIDE,
          editable: false,
          contextMenu: false,
          toolBar: false,
          keypress: false,
          allowUndo: false,
          locale: 'zh_CN',
        })
        mind.init(data)
        mind.initSide()
        mindRef.current = mind
        lastHashRef.current = codeHash

        // 仅在容器宽度 > 0 时才进行自适应缩放，避免 NaN 路径
        const width = el.clientWidth
        if (width > 0) {
          try {
            mind.scaleFit()
            mind.toCenter()
          } catch (e) {
            console.warn('Mind-elixir scaleFit failed', e)
          }
        } else {
          console.warn('Mind-elixir scaleFit skipped: container width is 0')
        }
      } catch (e) {
        console.error('[XMindBlock] Mind-elixir init failed', e)
        setError(e instanceof Error ? `思维导图渲染失败：${e.message}` : '思维导图渲染失败')
      }
    }

    const timer = window.setTimeout(init, 200)

    const resizeHandler = () => {
      if (!mindRef.current) return
      try {
        // 仅在容器宽度 > 0 时重新自适应缩放并居中
        const width = el.clientWidth
        if (width > 0) {
          mindRef.current.scaleFit()
          mindRef.current.toCenter()
        } else {
          console.warn('Mind-elixir scaleFit on resize skipped: container width is 0')
        }
      } catch (e) {
        console.warn('Mind-elixir scaleFit on resize failed', e)
      }
    }

    const observer = new ResizeObserver(() => resizeHandler())
    observer.observe(el)
    window.addEventListener('resize', resizeHandler)

    return () => {
      if (timer) window.clearTimeout(timer)
      window.removeEventListener('resize', resizeHandler)
      observer.disconnect()
      if (mindRef.current) {
        try {
          mindRef.current.destroy?.()
        } catch (e) {
          console.warn('Mind-elixir destroy on cleanup failed', e)
        }
        mindRef.current = null
      }
    }
  }, [data, error, codeHash])

  return (
    <>
      {error && (
        <div className="diagram-placeholder">
          <p>渲染失败：{error}</p>
          <pre className="code-inline">{code}</pre>
        </div>
      )}
      {!error && (
        <div
          ref={containerRef}
          className="diagram-canvas mind-center"
          style={{height: '100%', width: '100%', pointerEvents: 'none', cursor: 'default' }}
          aria-hidden
        />
      )}
    </>
  )
}

export interface DiagramRendererProps {
  lang: 'mermaid' | 'mind'
  code: string
}

export default function DiagramRenderer(props: Readonly<DiagramRendererProps>) {
  if (props.lang === 'mermaid') {
    return <MermaidBlock code={props.code} />
  }
  if (props.lang === 'mind') {
    return <XMindBlock code={props.code} />
  }
  return (
    <pre className="diagram-placeholder">不支持的图表类型：{props.lang}</pre>
  )
}

