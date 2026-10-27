import { createRef } from 'react'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownViewer, type MarkdownViewerHandle } from './MarkdownViewer'

vi.mock('../hooks/useMarkdownPreview', async () => {
  const { preparePreviewMarkdown } = await import('../modules/markdown/previewPipeline')
  return { useMarkdownPreview: preparePreviewMarkdown }
})
vi.mock('../modules/settings/editorSettings', async importOriginal => ({
  ...await importOriginal<typeof import('../modules/settings/editorSettings')>(),
  getPerformanceSettings: async () => ({ experimentalPreviewOptimization: false }),
}))

const document = `## Stable\n\n${'正文 '.repeat(500)}\n\n## Tail\n\n${'结尾 '.repeat(500)}`

describe('preview block updates', () => {
  it('does not rewrite metadata on unchanged blocks while typing elsewhere', async () => {
    const { container, rerender } = render(<MarkdownViewer value={document} />)
    await act(async () => {})
    const first = container.querySelector('.markdown-block-chunk')!
    expect(container.querySelectorAll('.markdown-block-chunk').length).toBeGreaterThan(1)
    const observer = new MutationObserver(() => {})
    observer.observe(first, { attributes: true })
    rerender(<MarkdownViewer value={document + '新增'} />)
    expect(container.querySelector('.markdown-block-chunk')).toBe(first)
    expect(observer.takeRecords()).toHaveLength(0)
    observer.disconnect()
  })

  it('keeps source-line navigation correct after earlier text moves a cached block', async () => {
    const onLineClick = vi.fn()
    const { container, rerender } = render(<MarkdownViewer value={document} onLineClick={onLineClick} />)
    await act(async () => {})
    const stable = container.querySelector<HTMLElement>('.markdown-block-chunk')!
    rerender(<MarkdownViewer value={'introduction\n\n' + document} onLineClick={onLineClick} />)
    expect(stable.isConnected).toBe(true)
    expect(stable.dataset.chunkStartLine).toBe('3')
    fireEvent.click(stable.querySelector('h2')!)
    expect(onLineClick).toHaveBeenLastCalledWith(3)
  })

  it('restores active-line lookup when a cached block is unfolded', async () => {
    const ref = createRef<MarkdownViewerHandle>()
    const { container, rerender } = render(<MarkdownViewer ref={ref} value={document} foldRegions={[{ fromLine: 1, toLine: 4 }]} />)
    await act(async () => {})
    expect(container.querySelector('h2')?.textContent).toBe('Tail')
    rerender(<MarkdownViewer ref={ref} value={document} foldRegions={[]} />)
    act(() => ref.current!.updateActiveLine(1))
    await waitFor(() => expect(container.querySelector('.active-source-line')?.textContent).toContain('Stable'))
  })
})
