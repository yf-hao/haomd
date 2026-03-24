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

function buildExportMermaidThemeVariables() {
  return {
    background: 'transparent',
    fontSize: '15px',
    primaryColor: '#ffffff',
    primaryTextColor: '#000000',
    primaryBorderColor: '#000000',
    lineColor: '#000000',
    textColor: '#000000',
    secondaryColor: '#ffffff',
    tertiaryColor: '#ffffff',
    clusterBkg: '#ffffff',
    clusterBorder: '#000000',
    nodeBorder: '#000000',
    edgeLabelBackground: '#ffffff',
    mainBkg: '#ffffff',
    actorBkg: '#ffffff',
    actorBorder: '#000000',
    actorTextColor: '#000000',
    labelBoxBkgColor: '#ffffff',
    labelBoxBorderColor: '#000000',
    labelTextColor: '#000000',
    signalColor: '#000000',
    signalTextColor: '#000000',
    noteBkgColor: '#ffffff',
    noteBorderColor: '#000000',
    noteTextColor: '#000000',
    activationBorderColor: '#000000',
    activationBkgColor: '#ffffff',
    sequenceNumberColor: '#000000',
    sectionBkgColor: '#ffffff',
    sectionBkgColor2: '#ffffff',
    sectionBorderColor: '#000000',
    altSectionBkgColor: '#ffffff',
    gridColor: '#000000',
    taskBorderColor: '#000000',
    taskBkgColor: '#ffffff',
    taskTextColor: '#000000',
    taskTextDarkColor: '#000000',
    taskTextOutsideColor: '#000000',
    taskTextClickableColor: '#000000',
    activeTaskBorderColor: '#000000',
    activeTaskBkgColor: '#ffffff',
    doneTaskBorderColor: '#000000',
    doneTaskBkgColor: '#ffffff',
    critBorderColor: '#000000',
    critBkgColor: '#ffffff',
    todayLineColor: '#000000',
    cScale0: '#ffffff',
    cScaleLabel0: '#000000',
    cScale1: '#ffffff',
    cScaleLabel1: '#000000',
    cScale2: '#ffffff',
    cScaleLabel2: '#000000',
    cScale3: '#ffffff',
    cScaleLabel3: '#000000',
    cScale4: '#ffffff',
    cScaleLabel4: '#000000',
    cScale5: '#ffffff',
    cScaleLabel5: '#000000',
    cScale6: '#ffffff',
    cScaleLabel6: '#000000',
    cScale7: '#ffffff',
    cScaleLabel7: '#000000',
    git0: '#ffffff',
    git1: '#ffffff',
    git2: '#ffffff',
    git3: '#ffffff',
    git4: '#ffffff',
    git5: '#ffffff',
    git6: '#ffffff',
    git7: '#ffffff',
    gitInv0: '#000000',
    gitInv1: '#000000',
    gitInv2: '#000000',
    gitInv3: '#000000',
    gitInv4: '#000000',
    gitInv5: '#000000',
    gitInv6: '#000000',
    gitInv7: '#000000',
  }
}

function buildMermaidThemeVariables(themeMode: ResolvedThemeMode) {
  if (themeMode === 'dark') {
    return {
      background: 'transparent',
      primaryColor: getCssThemeColor('--theme-surface-card', '#1e293b'),
      primaryTextColor: getCssThemeColor('--theme-text-default', '#e8ecf5'),
      primaryBorderColor: getCssThemeColor('--theme-accent-primary-alt-soft', '#62c3ff'),
      lineColor: getCssThemeColor('--theme-border-strong', '#94a3b8'),
      textColor: getCssThemeColor('--theme-text-default', '#e8ecf5'),
      secondaryColor: getCssThemeColor('--theme-surface-card-active', '#334155'),
      tertiaryColor: getCssThemeColor('--theme-surface-card', 'rgba(255, 255, 255, 0.02)'),
      clusterBkg: getCssThemeColor('--theme-surface-panel', '#05070c'),
      clusterBorder: getCssThemeColor('--theme-border-subtle', 'rgba(255, 255, 255, 0.06)'),
      nodeBorder: getCssThemeColor('--theme-accent-primary-alt-soft', '#62c3ff'),
      edgeLabelBackground: getCssThemeColor('--theme-surface-preview', '#0c0d16'),
      mainBkg: getCssThemeColor('--theme-surface-card', '#1e293b'),
    }
  }

  return {
    background: 'transparent',
    primaryColor: getCssThemeColor('--theme-surface-card', '#f8fafc'),
    primaryTextColor: getCssThemeColor('--theme-text-default', '#0f172a'),
    primaryBorderColor: getCssThemeColor('--theme-text-default', '#0f172a'),
    lineColor: getCssThemeColor('--theme-text-default', '#0f172a'),
    textColor: getCssThemeColor('--theme-text-default', '#0f172a'),
    secondaryColor: getCssThemeColor('--theme-surface-card-active', '#dbeafe'),
    tertiaryColor: getCssThemeColor('--theme-surface-card', 'rgba(15, 23, 42, 0.03)'),
    clusterBkg: getCssThemeColor('--theme-surface-panel', '#ffffff'),
    clusterBorder: getCssThemeColor('--theme-border-subtle', 'rgba(15, 23, 42, 0.08)'),
    nodeBorder: getCssThemeColor('--theme-text-default', '#0f172a'),
    edgeLabelBackground: getCssThemeColor('--theme-surface-preview', '#ffffff'),
    mainBkg: getCssThemeColor('--theme-surface-card', '#f8fafc'),
  }
}

function buildMermaidConfig(profile: MermaidRenderProfile, themeMode: ResolvedThemeMode = 'dark') {
  const resolvedThemeMode = profile === 'export' ? 'light' : themeMode

  return {
    startOnLoad: false,
    securityLevel: mermaidConfig.securityLevel,
    theme: 'base' as const,
    themeVariables: profile === 'export'
      ? buildExportMermaidThemeVariables()
      : buildMermaidThemeVariables(resolvedThemeMode),
    fontFamily: profile === 'export'
      ? 'SimSun, "Times New Roman", serif'
      : mermaidConfig.fontFamily,
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
  return normalizeMermaidSvg(rendered.svg, profile)
}

function normalizeMermaidSvg(svgMarkup: string, profile: MermaidRenderProfile = 'preview'): string {
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

      if (profile === 'export') {
        const textNodes = Array.from(svg.querySelectorAll('text, tspan'))
        for (const node of textNodes) {
          node.setAttribute('font-size', '15px')
          node.setAttribute('font-weight', '700')
        }
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

  if (profile === 'export') {
    normalized = normalized.replace(/<(text|tspan)\b([^>]*)>/gi, (_match, tag: string, attrs: string) => {
      let nextAttrs = attrs
      if (/\bfont-size="/i.test(nextAttrs)) {
        nextAttrs = nextAttrs.replace(/\bfont-size="[^"]*"/i, 'font-size="15px"')
      } else {
        nextAttrs += ' font-size="15px"'
      }
      if (/\bfont-weight="/i.test(nextAttrs)) {
        nextAttrs = nextAttrs.replace(/\bfont-weight="[^"]*"/i, 'font-weight="700"')
      } else {
        nextAttrs += ' font-weight="700"'
      }
      return `<${tag}${nextAttrs}>`
    })
  }

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

  if (width == null || height == null || rootWidth == null || rootHeight == null) return false
  if (x > 1 || y > 1) return false

  const nearlyFullWidth = width >= rootWidth * 0.9
  const nearlyFullHeight = height >= rootHeight * 0.9
  return nearlyFullWidth && nearlyFullHeight
}
