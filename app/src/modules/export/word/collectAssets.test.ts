import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockInvoke } from '../../../../vitest.setup'

vi.mock('@tauri-apps/api/path', () => ({
  dirname: vi.fn(async () => '/workspace/docs'),
  resolve: vi.fn(async (base: string, input: string) => `${base}/${input}`),
}))

import { collectWordAssets } from './collectAssets'
import type { WordDocPayload } from './types'

class MockImage {
  naturalWidth = 640
  naturalHeight = 480
  onload: null | (() => void) = null
  onerror: null | ((error?: unknown) => void) = null

  set src(_value: string) {
    queueMicrotask(() => {
      this.onload?.()
    })
  }
}

describe('export/word - collectWordAssets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('Image', MockImage)
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:word-export-image'),
      revokeObjectURL: vi.fn(),
    })
  })

  it('should resolve local image paths and measure dimensions', async () => {
    mockInvoke.mockResolvedValue({
      Ok: { data: [137, 80, 78, 71] },
    })

    const payload: WordDocPayload = {
      title: 'Sample',
      blocks: [],
      assets: [
        {
          id: 'asset_0',
          kind: 'image',
          sourcePath: 'images/demo.png',
        },
      ],
    }

    const result = await collectWordAssets({
      payload,
      filePath: '/workspace/docs/sample.md',
    })

    expect(mockInvoke).toHaveBeenCalledWith('read_binary_file', {
      path: '/workspace/docs/images/demo.png',
      trace_id: null,
    })
    expect(result.assets).toEqual([
      {
        id: 'asset_0',
        kind: 'image',
        sourcePath: '/workspace/docs/images/demo.png',
        mimeType: 'image/png',
        widthPx: 640,
        heightPx: 480,
      },
    ])
  })

  it('should reject remote image sources before reading files', async () => {
    const payload: WordDocPayload = {
      title: 'Remote',
      blocks: [],
      assets: [
        {
          id: 'asset_0',
          kind: 'image',
          sourcePath: 'https://example.com/demo.png',
        },
      ],
    }

    await expect(
      collectWordAssets({
        payload,
        filePath: '/workspace/docs/sample.md',
      }),
    ).rejects.toThrow('Word 导出暂不支持远程图片: https://example.com/demo.png')

    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('should fail when backend returns no image bytes', async () => {
    mockInvoke.mockResolvedValue({ Ok: { data: [] } })

    const payload: WordDocPayload = {
      title: 'Missing',
      blocks: [],
      assets: [
        {
          id: 'asset_0',
          kind: 'image',
          sourcePath: 'images/missing.png',
        },
      ],
    }

    await expect(
      collectWordAssets({
        payload,
        filePath: '/workspace/docs/sample.md',
      }),
    ).rejects.toThrow('读取图片失败: /workspace/docs/images/missing.png')
  })
})
