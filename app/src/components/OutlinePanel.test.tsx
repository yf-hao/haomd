import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '../modules/i18n/I18nContext'
import { ThemeModeProvider } from '../modules/theme/ThemeContext'
import { getDefaultThemeSettings } from '../modules/settings/editorSettings'
import { resolveActiveTheme } from '../modules/theme/themeResolver'
import { OutlinePanel } from './OutlinePanel'

function renderWithProviders(node: ReactNode) {
  return render(
    <I18nProvider value={{ languageMode: 'zh-CN', resolvedLanguage: 'zh-CN', ready: true }}>
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

describe('OutlinePanel', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('shows headings up to level 2 by default', () => {
    renderWithProviders(
      <OutlinePanel
        items={[
          {
            id: 'h1',
            level: 1,
            text: '一级标题',
            line: 1,
            searchText: '一级标题',
            children: [
              {
                id: 'h2',
                level: 2,
                text: '二级标题',
                line: 2,
                searchText: '二级标题',
                children: [
                  {
                    id: 'h3',
                    level: 3,
                    text: '三级标题',
                    line: 3,
                    searchText: '三级标题',
                    children: [],
                  },
                ],
              },
            ],
          },
        ]}
        activeId={null}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText('一级标题')).toBeDefined()
    expect(screen.getByText('二级标题')).toBeDefined()
    expect(screen.queryByText('三级标题')).toBeNull()
  })

  it('limits the visible depth from the dropdown', () => {
    renderWithProviders(
      <OutlinePanel
        items={[
          {
            id: 'h1',
            level: 1,
            text: '一级标题',
            line: 1,
            searchText: '一级标题',
            children: [
              {
                id: 'h2',
                level: 2,
                text: '二级标题',
                line: 2,
                searchText: '二级标题',
                children: [
                  {
                    id: 'h3',
                    level: 3,
                    text: '三级标题',
                    line: 3,
                    searchText: '三级标题',
                    children: [],
                  },
                ],
              },
            ],
          },
        ]}
        activeId={null}
        onSelect={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByLabelText('显示层级'))
    fireEvent.click(screen.getByRole('menuitemradio', { name: '展开到 2 级' }))

    expect(screen.getByText('一级标题')).toBeDefined()
    expect(screen.getByText('二级标题')).toBeDefined()
    expect(screen.queryByText('三级标题')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '展开' }))

    expect(screen.getByText('三级标题')).toBeDefined()
  })
})
