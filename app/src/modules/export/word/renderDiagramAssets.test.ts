import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({
      svg: '<svg width="240" height="120" viewBox="0 0 240 120"><foreignObject x="20" y="20" width="120" height="48"><div xmlns="http://www.w3.org/1999/xhtml" style="line-height: 1.5"><p>资源层 config.yaml /</p><p>FingerDir.yaml / DirDict</p></div></foreignObject><rect width="240" height="120"/></svg>',
    })),
  },
}))

vi.mock('mind-elixir', () => {
  class MockMindElixir {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(_opts: any) {}
    init() {}
    initSide() {}
    scaleFit() {}
    toCenter() {}
    exportSvg() {
      return {
        async text() {
          return '<svg width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180"/></svg>'
        },
      }
    }
  }

  return {
    __esModule: true,
    default: MockMindElixir,
    SIDE: 0,
  }
})

import { renderWordDiagramAssets, replaceForeignObjectWithText } from './renderDiagramAssets'
import type { WordDocPayload } from './types'

class MockImage {
  naturalWidth = 320
  naturalHeight = 180
  onload: null | (() => void) = null
  onerror: null | ((error?: unknown) => void) = null

  set src(_value: string) {
    queueMicrotask(() => {
      this.onload?.()
    })
  }
}

describe('export/word - renderWordDiagramAssets', () => {
  const a4BodyWidthPx = 602
  const a4BodyHeightPx = 301

  beforeEach(() => {
    vi.clearAllMocks()
    invokeMock.mockReset()
    vi.stubGlobal('Image', MockImage)
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:word-diagram'),
      revokeObjectURL: vi.fn(),
    })

    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      scale: vi.fn(),
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      set fillStyle(_value: string) {},
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.toDataURL = vi.fn(
      () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9l9WQAAAAASUVORK5CYII=',
    )
  })

  it('should convert mermaid code blocks into embedded png assets', async () => {
    const payload: WordDocPayload = {
      title: 'Mermaid',
      assets: [],
      blocks: [
        {
          type: 'code',
          language: 'mermaid',
          content: 'flowchart LR\nA-->B',
        },
      ],
    }
    const setStatusMessage = vi.fn()

    const result = await renderWordDiagramAssets({ payload, setStatusMessage })

    expect(setStatusMessage).toHaveBeenCalledWith('正在渲染 Mermaid 图表...')
    expect(result.blocks).toEqual([
      {
        type: 'image',
        assetId: 'asset_0',
        alt: 'Mermaid Diagram',
        widthPx: a4BodyWidthPx,
        heightPx: a4BodyHeightPx,
      },
    ])
    expect(result.assets).toEqual([
      expect.objectContaining({
        id: 'asset_0',
        kind: 'embedded-image',
        fileName: 'asset_0.png',
        mimeType: 'image/png',
      }),
    ])
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalled()

    const { default: mermaid } = await import('mermaid')
    expect(vi.mocked(mermaid.initialize)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        theme: 'base',
        fontFamily: 'SimSun, "Times New Roman", serif',
        themeVariables: expect.objectContaining({
          fontSize: '15px',
          primaryColor: '#ffffff',
          primaryBorderColor: '#000000',
          lineColor: '#000000',
          textColor: '#000000',
          clusterBkg: '#ffffff',
          clusterBorder: '#000000',
          edgeLabelBackground: '#ffffff',
        }),
      }),
    )
  })

  it('should increase export font size for dense mermaid diagrams', async () => {
    const payload: WordDocPayload = {
      title: 'Dense Mermaid',
      assets: [],
      blocks: [
        {
          type: 'code',
          language: 'mermaid',
          content: `flowchart TD
A[资源层 config.yaml / FingerDir.yaml / DirDict]
B[扫描编排 scanner.py]
C[表示层 GUI 界面]
D[能力层 指纹识别]
E[代理层 proxy_pool.py]
F[UA层 ua_pool.py]
G[用户]
G --> C
C --> B
B --> A
B --> D
B --> E
B --> F`,
        },
      ],
    }

    await renderWordDiagramAssets({ payload })

    const { default: mermaid } = await import('mermaid')
    expect(vi.mocked(mermaid.initialize)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        themeVariables: expect.objectContaining({
          fontSize: '18px',
        }),
      }),
    )
  })

  it('should convert mermaid code blocks into embedded emf assets when inkscape is preferred', async () => {
    invokeMock.mockResolvedValue('ZW1m')

    const payload: WordDocPayload = {
      title: 'Mermaid',
      assets: [],
      blocks: [
        {
          type: 'code',
          language: 'mermaid',
          content: 'flowchart LR\nA-->B',
        },
      ],
    }

    const result = await renderWordDiagramAssets({
      payload,
      preferInkscapeForMermaid: true,
      mermaidExportFormat: 'emf',
    })

    expect(invokeMock).toHaveBeenCalledWith('convert_svg_to_emf', expect.any(Object))
    expect(result.assets).toEqual([
      expect.objectContaining({
        id: 'asset_0',
        kind: 'embedded-image',
        fileName: 'asset_0.emf',
        mimeType: 'image/x-emf',
        base64Data: 'ZW1m',
        widthPx: a4BodyWidthPx,
        heightPx: a4BodyHeightPx,
      }),
    ])
    expect(HTMLCanvasElement.prototype.toDataURL).not.toHaveBeenCalled()
  })

  it('should convert mermaid code blocks into embedded svg assets when svg export is preferred', async () => {
    invokeMock.mockResolvedValue('c3Zn')

    const payload: WordDocPayload = {
      title: 'Mermaid',
      assets: [],
      blocks: [
        {
          type: 'code',
          language: 'mermaid',
          content: 'flowchart LR\nA-->B',
        },
      ],
    }

    const result = await renderWordDiagramAssets({
      payload,
      preferInkscapeForMermaid: true,
      mermaidExportFormat: 'svg',
    })

    expect(invokeMock).toHaveBeenCalledWith('convert_svg_to_plain_svg', expect.any(Object))
    expect(result.assets).toEqual([
      expect.objectContaining({
        id: 'asset_0',
        kind: 'embedded-image',
        fileName: 'asset_0.svg',
        mimeType: 'image/svg+xml',
        base64Data: 'c3Zn',
        widthPx: a4BodyWidthPx,
        heightPx: a4BodyHeightPx,
      }),
    ])
    expect(HTMLCanvasElement.prototype.toDataURL).not.toHaveBeenCalled()
  })

  it('should fall back to png when inkscape conversion fails', async () => {
    invokeMock.mockRejectedValueOnce(new Error('inkscape failed'))

    const payload: WordDocPayload = {
      title: 'Mermaid',
      assets: [],
      blocks: [
        {
          type: 'code',
          language: 'mermaid',
          content: 'flowchart LR\nA-->B',
        },
      ],
    }

    const result = await renderWordDiagramAssets({ payload, preferInkscapeForMermaid: true })

    expect(result.assets).toEqual([
      expect.objectContaining({
        id: 'asset_0',
        kind: 'embedded-image',
        fileName: 'asset_0.png',
        mimeType: 'image/png',
      }),
    ])
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalled()
  })

  it('should keep sequence diagrams on png even when inkscape is preferred', async () => {
    invokeMock.mockResolvedValue('ZW1m')

    const payload: WordDocPayload = {
      title: 'Sequence',
      assets: [],
      blocks: [
        {
          type: 'code',
          language: 'mermaid',
          content: 'sequenceDiagram\nAlice->>Bob: Hello',
        },
      ],
    }

    const result = await renderWordDiagramAssets({ payload, preferInkscapeForMermaid: true })

    expect(invokeMock).not.toHaveBeenCalled()
    expect(result.assets).toEqual([
      expect.objectContaining({
        id: 'asset_0',
        kind: 'embedded-image',
        fileName: 'asset_0.png',
        mimeType: 'image/png',
      }),
    ])
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalled()
  })

  it('should export sequence diagrams as plain svg when svg export is preferred', async () => {
    invokeMock.mockResolvedValue('c3Zn')

    const payload: WordDocPayload = {
      title: 'Sequence SVG',
      assets: [],
      blocks: [
        {
          type: 'code',
          language: 'mermaid',
          content: 'sequenceDiagram\nAlice->>Bob: Hello',
        },
      ],
    }

    const result = await renderWordDiagramAssets({
      payload,
      preferInkscapeForMermaid: true,
      mermaidExportFormat: 'svg',
    })

    expect(invokeMock).toHaveBeenCalledWith('convert_svg_to_plain_svg', expect.any(Object))
    expect(result.assets).toEqual([
      expect.objectContaining({
        id: 'asset_0',
        kind: 'embedded-image',
        fileName: 'asset_0.svg',
        mimeType: 'image/svg+xml',
        base64Data: 'c3Zn',
        widthPx: a4BodyWidthPx,
        heightPx: a4BodyHeightPx,
      }),
    ])
    expect(HTMLCanvasElement.prototype.toDataURL).not.toHaveBeenCalled()
  })

  it('should preserve multiline foreignObject labels when rasterizing mermaid svg', async () => {
    const svgMarkup = replaceForeignObjectWithText(
      '<svg width="240" height="120" viewBox="0 0 240 120"><foreignObject x="20" y="20" width="120" height="48"><div xmlns="http://www.w3.org/1999/xhtml" style="line-height: 1.5"><p>资源层 config.yaml /</p><p>FingerDir.yaml / DirDict</p></div></foreignObject></svg>',
    )
    expect(svgMarkup).toContain('<tspan')
    expect(svgMarkup).toContain('资源层')
    expect(svgMarkup).toContain('config.yaml /')
    expect(svgMarkup).toContain('FingerDir.yaml')
    expect(svgMarkup).toContain('DirDict')
  })

  it('should wrap long single-line foreignObject labels by width before rasterizing', async () => {
    const svgMarkup = replaceForeignObjectWithText(
      '<svg width="240" height="120" viewBox="0 0 240 120"><foreignObject x="20" y="20" width="120" height="48"><div xmlns="http://www.w3.org/1999/xhtml">资源层 config.yaml / FingerDir.yaml / DirDict</div></foreignObject></svg>',
    )
    const tspanCount = (svgMarkup.match(/<tspan/g) || []).length
    expect(tspanCount).toBeGreaterThan(1)
    expect(svgMarkup).toContain('资源层')
    expect(svgMarkup).toContain('config.yaml /')
    expect(svgMarkup).toContain('FingerDir.yaml')
    expect(svgMarkup).toContain('DirDict')
  })

  it('should convert mind code blocks into embedded png assets', async () => {
    const payload: WordDocPayload = {
      title: 'Mind',
      assets: [],
      blocks: [
        {
          type: 'code',
          language: 'mind',
          content: 'Root\n  Child',
        },
      ],
    }
    const setStatusMessage = vi.fn()

    const result = await renderWordDiagramAssets({ payload, setStatusMessage })

    expect(setStatusMessage).toHaveBeenCalledWith('正在渲染思维导图...')
    expect(result.blocks[0]).toEqual({
      type: 'image',
      assetId: 'asset_0',
      alt: 'Mind Diagram',
      widthPx: 320,
      heightPx: 180,
    })
    expect(result.assets).toHaveLength(1)
  })

  it('should throw a clear error when mermaid rendering fails', async () => {
    const { default: mermaid } = await import('mermaid')
    vi.mocked(mermaid.render).mockRejectedValueOnce(new Error('boom'))

    const payload: WordDocPayload = {
      title: 'Broken',
      assets: [],
      blocks: [
        {
          type: 'code',
          language: 'mermaid',
          content: 'flowchart LR\nBroken-->Diagram',
        },
      ],
    }

    await expect(renderWordDiagramAssets({ payload })).rejects.toThrow(
      'Mermaid 图表渲染失败: boom',
    )
  })
})
