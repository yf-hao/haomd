import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({
      svg: '<svg width="240" height="120" viewBox="0 0 240 120"><rect width="240" height="120"/></svg>',
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

import { renderWordDiagramAssets } from './renderDiagramAssets'
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
  beforeEach(() => {
    vi.clearAllMocks()
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
        widthPx: 240,
        heightPx: 120,
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

    const { default: mermaid } = await import('mermaid')
    expect(vi.mocked(mermaid.initialize)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        theme: 'base',
        themeVariables: expect.objectContaining({
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
