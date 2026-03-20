import { mermaidConfig } from '../../config/renderers'

let mermaidInstance: typeof import('mermaid').default | null = null
let mermaidInitPromise: Promise<typeof import('mermaid').default> | null = null

type MermaidRenderProfile = 'preview' | 'export'

function buildMermaidConfig(profile: MermaidRenderProfile) {
  return {
    startOnLoad: false,
    securityLevel: mermaidConfig.securityLevel,
    theme: mermaidConfig.theme,
    fontFamily: mermaidConfig.fontFamily,
    ...(profile === 'export'
      ? {
          theme: 'default' as const,
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
  options?: { profile?: MermaidRenderProfile },
): Promise<string> {
  const lib = await loadMermaid()
  lib.initialize(buildMermaidConfig(options?.profile ?? 'preview'))
  const renderId = id ?? `mermaid-${Math.random().toString(36).slice(2)}`
  const rendered = await lib.render(renderId, code)
  return rendered.svg
}
