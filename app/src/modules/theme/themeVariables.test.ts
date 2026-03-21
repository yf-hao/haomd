import { describe, expect, it } from 'vitest'
import { darkTheme } from './themes/darkTheme'
import { createThemeVariableMap } from './themeVariables'

describe('themeVariables', () => {
  it('creates semantic css variable map from theme tokens', () => {
    const vars = createThemeVariableMap(darkTheme.tokens)

    expect(vars['--theme-surface-editor']).toBe(darkTheme.tokens.surface.editor)
    expect(vars['--theme-text-default']).toBe(darkTheme.tokens.text.default)
    expect(vars['--theme-border-input']).toBe(darkTheme.tokens.border.input)
    expect(vars['--theme-component-tabbar-height']).toBe(darkTheme.tokens.component.tabBarHeight)
  })
})
