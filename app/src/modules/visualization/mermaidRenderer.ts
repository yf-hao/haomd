import { mermaidConfig } from '../../config/renderers'
import type { ResolvedThemeMode } from '../theme/themeRuntime'

let mermaidInstance: typeof import('mermaid').default | null = null
let mermaidInitPromise: Promise<typeof import('mermaid').default> | null = null

type MermaidRenderProfile = 'preview' | 'export'

function getCssThemeColor(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function buildMermaidThemeVariables(themeMode: ResolvedThemeMode) {
  if (themeMode === 'dark') {
    return {
      background: 'transparent',
      primaryColor: getCssThemeColor('--haomd-card-bg', '#1e293b'),
      primaryTextColor: getCssThemeColor('--z-color-fg-default', '#e8ecf5'),
      primaryBorderColor: getCssThemeColor('--z-color-accent-primary-alt-soft', '#62c3ff'),
      lineColor: getCssThemeColor('--z-color-border-strong', '#94a3b8'),
      textColor: getCssThemeColor('--z-color-fg-default', '#e8ecf5'),
      secondaryColor: getCssThemeColor('--haomd-card-bg-active', '#334155'),
      tertiaryColor: getCssThemeColor('--z-color-bg-surface', 'rgba(255, 255, 255, 0.02)'),
      clusterBkg: getCssThemeColor('--haomd-panel-bg', '#05070c'),
      clusterBorder: getCssThemeColor('--z-color-border-subtle', 'rgba(255, 255, 255, 0.06)'),
      nodeBorder: getCssThemeColor('--z-color-accent-primary-alt-soft', '#62c3ff'),
      edgeLabelBackground: getCssThemeColor('--haomd-preview-bg', '#0c0d16'),
      mainBkg: getCssThemeColor('--haomd-card-bg', '#1e293b'),
    }
  }

  return {
    background: 'transparent',
    primaryColor: getCssThemeColor('--haomd-card-bg', '#f8fafc'),
    primaryTextColor: getCssThemeColor('--z-color-fg-default', '#0f172a'),
    primaryBorderColor: getCssThemeColor('--z-color-fg-default', '#0f172a'),
    lineColor: getCssThemeColor('--z-color-fg-default', '#0f172a'),
    textColor: getCssThemeColor('--z-color-fg-default', '#0f172a'),
    secondaryColor: getCssThemeColor('--haomd-card-bg-active', '#dbeafe'),
    tertiaryColor: getCssThemeColor('--z-color-bg-surface', 'rgba(15, 23, 42, 0.03)'),
    clusterBkg: getCssThemeColor('--haomd-panel-bg', '#ffffff'),
    clusterBorder: getCssThemeColor('--z-color-border-subtle', 'rgba(15, 23, 42, 0.08)'),
    nodeBorder: getCssThemeColor('--z-color-fg-default', '#0f172a'),
    edgeLabelBackground: getCssThemeColor('--haomd-preview-bg', '#ffffff'),
    mainBkg: getCssThemeColor('--haomd-card-bg', '#f8fafc'),
  }
}

function buildMermaidConfig(profile: MermaidRenderProfile, themeMode: ResolvedThemeMode = 'dark') {
  const resolvedThemeMode = profile === 'export' ? 'light' : themeMode

  return {
    startOnLoad: false,
    securityLevel: mermaidConfig.securityLevel,
    theme: 'base' as const,
    themeVariables: buildMermaidThemeVariables(resolvedThemeMode),
    fontFamily: mermaidConfig.fontFamily,
    ...(profile === 'export'
      ? {
          flowchart: {
            htmlLabels: false,
            useMaxWidth: false,
          },
          sequence: {
            useMaxWidth: false,
          },
          class: {
            htmlLabels: false,
            useMaxWidth: false,
          },
          state: {
            htmlLabels: false,
            useMaxWidth: false,
          },
          er: {
            useMaxWidth: false,
          },
          journey: {
            useMaxWidth: false,
          },
          gantt: {
            useMaxWidth: false,
          },
        }
      : {}),
  }
}

export function loadMermaid() {
  if (mermaidInstance) return Promise.resolve(mermaidInstance)
  if (mermaidInitPromise) return mermaidInitPromise

  mermaidInitPromise = import('mermaid').then((m) => {
    const lib = m.default
    lib.initialize(buildMermaidConfig('preview'))
    mermaidInstance = lib
    return lib
  })

  return mermaidInitPromise
}

export async function renderMermaidToSvg(
  code: string,
  id?: string,
  options?: { profile?: MermaidRenderProfile; themeMode?: ResolvedThemeMode },
): Promise<string> {
  const lib = await loadMermaid()
  const profile = options?.profile ?? 'preview'
  const themeMode = options?.themeMode ?? 'dark'
  lib.initialize(buildMermaidConfig(profile, themeMode))
  const renderId = id ?? `mermaid-${Math.random().toString(36).slice(2)}`
  const rendered = await lib.render(renderId, code)
  return normalizeMermaidSvg(rendered.svg)
}

function normalizeMermaidSvg(svgMarkup: string): string {
  if (typeof DOMParser !== 'undefined' && typeof XMLSerializer !== 'undefined') {
    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(svgMarkup, 'image/svg+xml')
      const svg = doc.documentElement
      const rootStyle = svg.getAttribute('style') ?? ''
      const cleanedRootStyle = rootStyle
        .replace(/background(?:-color)?:\s*[^;"]+;?/gi, '')
        .replace(/;;+/g, ';')
        .trim()
      svg.setAttribute('style', `${cleanedRootStyle}${cleanedRootStyle ? ';' : ''}background: transparent;`)

      const rootWidth = readSvgDimension(svg.getAttribute('width')) ?? readViewBoxDimension(svg.getAttribute('viewBox'), 2)
      const rootHeight = readSvgDimension(svg.getAttribute('height')) ?? readViewBoxDimension(svg.getAttribute('viewBox'), 3)

      const candidates = Array.from(svg.querySelectorAll(':scope > rect, :scope > g > rect'))
      for (const rect of candidates) {
        if (!isLikelyMermaidBackdrop(rect, rootWidth, rootHeight)) continue
        rect.setAttribute('fill', 'transparent')
        rect.setAttribute('stroke', 'transparent')
      }

      const styleNodes = Array.from(svg.querySelectorAll('style'))
      for (const styleNode of styleNodes) {
        const text = styleNode.textContent ?? ''
        styleNode.textContent = text
          .replace(/background-color:\s*[^;}\n]+;?/gi, '')
          .replace(/background:\s*[^;}\n]+;?/gi, '')
      }

      return new XMLSerializer().serializeToString(doc)
    } catch {
      // fall through to string-based normalization
    }
  }

  let normalized = svgMarkup

  normalized = normalized.replace(
    /(<svg\b[^>]*?)\sstyle="([^"]*)"/i,
    (_match, prefix: string, styleValue: string) => {
      const cleaned = styleValue
        .replace(/background(?:-color)?:\s*[^;"]+;?/gi, '')
        .replace(/;;+/g, ';')
        .trim()
      return cleaned ? `${prefix} style="${cleaned}"` : prefix
    },
  )

  normalized = normalized.replace(/background-color:\s*[^;}\n]+;?/gi, '')
  normalized = normalized.replace(/background:\s*[^;}\n]+;?/gi, '')

  if (!/\bstyle="/i.test(normalized.match(/<svg\b[^>]*>/i)?.[0] ?? '')) {
    normalized = normalized.replace(/<svg\b/i, '<svg style="background: transparent;"')
  } else {
    normalized = normalized.replace(
      /(<svg\b[^>]*\bstyle=")([^"]*)"/i,
      (_match, prefix: string, styleValue: string) => `${prefix}${styleValue};background: transparent;"`,
    )
  }

  return normalized
}

function readSvgDimension(value: string | null): number | null {
  if (!value) return null
  const normalized = value.trim()
  if (!normalized || normalized.endsWith('%')) return null
  const parsed = Number.parseFloat(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function readViewBoxDimension(viewBox: string | null, index: 2 | 3): number | null {
  if (!viewBox) return null
  const parts = viewBox
    .trim()
    .split(/[\s,]+/)
    .map((part) => Number.parseFloat(part))
  const value = parts[index]
  return Number.isFinite(value) ? value : null
}

function isLikelyMermaidBackdrop(rect: Element, rootWidth: number | null, rootHeight: number | null): boolean {
  const width = readSvgDimension(rect.getAttribute('width'))
  const height = readSvgDimension(rect.getAttribute('height'))
  const x = readSvgDimension(rect.getAttribute('x')) ?? 0
  const y = readSvgDimension(rect.getAttribute('y')) ?? 0
  const rx = readSvgDimension(rect.getAttribute('rx')) ?? 0
  const ry = readSvgDimension(rect.getAttribute('ry')) ?? 0

  if (width == null || height == null || rootWidth == null || rootHeight == null) return false
  if (x > 1 || y > 1) return false

  const nearlyFullWidth = width >= rootWidth * 0.9
  const nearlyFullHeight = height >= rootHeight * 0.9
  return nearlyFullWidth && nearlyFullHeight
}
