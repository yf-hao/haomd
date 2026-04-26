// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GlobalSearchPanel, resetGlobalSearchPanelCache } from './GlobalSearchPanel'
import { I18nProvider } from '../modules/i18n/I18nContext'
import { ThemeModeProvider } from '../modules/theme/ThemeContext'
import { getDefaultThemeSettings } from '../modules/settings/editorSettings'
import { resolveActiveTheme } from '../modules/theme/themeResolver'

const { searchWorkspaceContentsMock } = vi.hoisted(() => ({
  searchWorkspaceContentsMock: vi.fn(),
}))

vi.mock('../modules/search/searchService', () => ({
  searchWorkspaceContents: searchWorkspaceContentsMock,
}))

function renderWithProviders(node: ReactNode) {
  return render(
    <I18nProvider value={{ languageMode: 'zh-CN', resolvedLanguage: 'zh-CN' }}>
      <ThemeModeProvider
        value={{
          selectedMode: 'system',
          resolvedMode: 'light',
          themeSettings: getDefaultThemeSettings(),
          activeTheme: resolveActiveTheme('light', false),
        }}
      >
        {node}
      </ThemeModeProvider>
    </I18nProvider>,
  )
}

describe('GlobalSearchPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetGlobalSearchPanelCache()
  })

  it('issues a debounced search with inline toggle options', async () => {
    searchWorkspaceContentsMock.mockResolvedValue({
      ok: true,
      data: {
        files: [],
        totalMatches: 0,
        totalFilesScanned: 2,
        truncated: false,
      },
    })

    renderWithProviders(
      <GlobalSearchPanel
        folderRoots={['/root']}
        standaloneFiles={[{ path: '/standalone.md' }]}
        onOpenResult={vi.fn()}
        onStatusMessage={vi.fn()}
      />,
    )

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('搜索文件内容'), {
        target: { value: 'demo' },
      })
      fireEvent.click(screen.getByTitle('区分大小写'))
      fireEvent.click(screen.getByTitle('全词匹配'))
      fireEvent.click(screen.getByTitle('正则'))
      await new Promise((resolve) => window.setTimeout(resolve, 320))
    })

    await waitFor(() => {
      expect(searchWorkspaceContentsMock).toHaveBeenCalledTimes(1)
    })

    expect(searchWorkspaceContentsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'demo',
        caseSensitive: true,
        wholeWord: true,
        regex: true,
        scope: {
          folderRoots: ['/root'],
          standaloneFiles: ['/standalone.md'],
        },
      }),
    )
  })

  it('opens a selected hit with line and query', async () => {
    const onOpenResult = vi.fn()

    searchWorkspaceContentsMock.mockResolvedValue({
      ok: true,
      data: {
        files: [
          {
            path: '/root/doc.md',
            matchCount: 1,
            hits: [
              {
                line: 12,
                columnStart: 3,
                columnEnd: 7,
                preview: 'hello demo world',
              },
            ],
          },
        ],
        totalMatches: 1,
        totalFilesScanned: 1,
        truncated: false,
      },
    })

    renderWithProviders(
      <GlobalSearchPanel
        folderRoots={['/root']}
        standaloneFiles={[]}
        onOpenResult={onOpenResult}
      />,
    )

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('搜索文件内容'), {
        target: { value: 'demo' },
      })
      await new Promise((resolve) => window.setTimeout(resolve, 320))
    })

    await screen.findByText('hello demo world')
    fireEvent.click(screen.getByText('hello demo world'))

    expect(onOpenResult).toHaveBeenCalledWith({
      path: '/root/doc.md',
      line: 12,
      columnStart: 3,
      searchText: 'demo',
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    })
  })

  it('restores the previous query and results after remount', async () => {
    searchWorkspaceContentsMock.mockResolvedValue({
      ok: true,
      data: {
        files: [
          {
            path: '/root/notes.md',
            matchCount: 1,
            hits: [
              {
                line: 3,
                columnStart: 1,
                columnEnd: 5,
                preview: 'demo line',
              },
            ],
          },
        ],
        totalMatches: 1,
        totalFilesScanned: 1,
        truncated: false,
      },
    })

    const first = renderWithProviders(
      <GlobalSearchPanel
        folderRoots={['/root']}
        standaloneFiles={[]}
        onOpenResult={vi.fn()}
      />,
    )

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('搜索文件内容'), {
        target: { value: 'demo' },
      })
      await new Promise((resolve) => window.setTimeout(resolve, 320))
    })

    await screen.findByText('demo line')
    first.unmount()

    renderWithProviders(
      <GlobalSearchPanel
        folderRoots={['/root']}
        standaloneFiles={[]}
        onOpenResult={vi.fn()}
      />,
    )

    expect((screen.getByPlaceholderText('搜索文件内容') as HTMLInputElement).value).toBe('demo')
    expect(screen.getByText('demo line')).toBeDefined()
  })
})
