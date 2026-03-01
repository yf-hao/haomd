import { describe, it, expect, vi, beforeEach } from 'vitest'
import { save } from '@tauri-apps/plugin-dialog'

// mock Tauri path.dirname，避免在测试中调用真实的 Tauri API
vi.mock('@tauri-apps/api/path', () => ({
  dirname: vi.fn(async () => '/tmp'),
}))

// mock 文件服务，避免真的触发 Tauri invoke
vi.mock('../../files/service', () => ({
  writeFileNoRecent: vi.fn(),
}))

// mock mind-elixir，提供一个最小可用的实现，支持 new 和 exportSvg
vi.mock('mind-elixir', () => {
  class MockMindElixir {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(_opts: any) {}
    init() {}
    initSide() {}
    exportSvg() {
      const svg = '<svg width="200" height="100"><rect width="200" height="100"/></svg>'
      return {
        // 模拟 Blob.text()
        async text() {
          return svg
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

// mock React SSR 渲染，直接返回传入组件的 markdown 文本，避免真正渲染复杂组件树
vi.mock('react-dom/server', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderToString: vi.fn((element: any) => (element && (element as any).props?.markdown) || ''),
}))

// mock ExportWrapper 组件
vi.mock('./components/ExportWrapper', () => ({
  ExportWrapper: () => null,
}))

// mock HTML 模板生成，返回简单字符串
vi.mock('./template', () => ({
  generateHTMLTemplate: vi.fn((opts: { body: string }) => `<html><body>${opts.body}</body></html>`),
}))

// mock 图片处理，直接原样返回
vi.mock('./imageHandler', () => ({
  convertImagesToBase64: vi.fn(async (html: string) => html),
}))

// 在所有 mock 之后导入被测函数和依赖
import { exportToHtml, prepareExportHtmlContents } from './index'
import { writeFileNoRecent } from '../../files/service'
import { convertImagesToBase64 } from './imageHandler'
import { generateHTMLTemplate } from './template'

function createMockCtx() {
  return {
    getCurrentFileName: vi.fn(() => 'demo.md'),
    getCurrentMarkdown: vi.fn(() => '# Title'),
    getFilePath: vi.fn(() => '/path/demo.md'),
    setStatusMessage: vi.fn(),
  }
}

describe('export/html - exportToHtml', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return false when user cancels save dialog', async () => {
    ;(save as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(null)
    const ctx = createMockCtx()

    const result = await exportToHtml(ctx as any)

    expect(result).toBe(false)
    expect(writeFileNoRecent).not.toHaveBeenCalled()
  })

  it('should write file and return true on success', async () => {
    ;(save as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue('/tmp/demo.html')
    const ctx = createMockCtx()

    ;(writeFileNoRecent as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      ok: true,
      data: { path: '/tmp/demo.html' },
    })

    const result = await exportToHtml(ctx as any)

    expect(result).toBe(true)
    expect(writeFileNoRecent).toHaveBeenCalledWith({
      path: '/tmp/demo.html',
      content: expect.any(String),
    })
    expect(ctx.setStatusMessage).toHaveBeenLastCalledWith('导出成功: /tmp/demo.html')
  })

  it('should return false and set error message when write fails', async () => {
    ;(save as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue('/tmp/demo.html')
    const ctx = createMockCtx()

    ;(writeFileNoRecent as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      ok: false,
      error: { message: 'boom' },
    })

    const result = await exportToHtml(ctx as any)

    expect(result).toBe(false)
    expect(ctx.setStatusMessage).toHaveBeenLastCalledWith('导出失败: boom')
  })
})

describe('export/html - prepareExportHtmlContents & mind blocks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render mind code block into SVG wrapper and normalize svg size', async () => {
    const ctx = createMockCtx()
    ;(ctx.getCurrentMarkdown as any).mockReturnValue(
      '# Title\n```mind\n{"title":"Root","children":[{"title":"Child"}]}\n```\n',
    )

    const result = await prepareExportHtmlContents(ctx as any)

    expect(ctx.setStatusMessage).toHaveBeenCalledWith('正在渲染思维导图...')
    expect(ctx.setStatusMessage).toHaveBeenCalledWith('正在构建页面结构...')
    expect(ctx.setStatusMessage).toHaveBeenCalledWith('正在处理图片资源...')

    expect(convertImagesToBase64).toHaveBeenCalled()
    expect(generateHTMLTemplate).toHaveBeenCalled()

    expect(result.fullHtml).toContain('mind-diagram-export')
    expect(result.fullHtml).toContain('<svg')
    expect(result.fullHtml).toContain('width="100%"')
  })

  it('should keep original mind block and append warning when render fails', async () => {
    const ctx = createMockCtx()
    ;(ctx.getCurrentMarkdown as any).mockReturnValue(
      '# Title\n```mind\n   \n```\n',
    )

    const result = await prepareExportHtmlContents(ctx as any)

    expect(result.fullHtml).toContain('⚠️ 思维导图渲染失败')
  })
})
