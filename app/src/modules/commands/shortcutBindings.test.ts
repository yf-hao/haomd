import { describe, expect, it } from 'vitest'
import {
  FORMAT_MENU_ACCELERATORS,
  FORMAT_SHORTCUT_ACTIONS,
  FORMAT_SHORTCUT_BINDINGS,
  GLOBAL_MENU_ACCELERATORS,
} from './shortcutBindings'
import menuSource from '../../../src-tauri/src/menu.rs?raw'

function expectAcceleratorsToMatch(accelerators: Readonly<Record<string, string>>) {
  const normalizedMenuSource = menuSource.toLowerCase()
  for (const [action, accelerator] of Object.entries(accelerators)) {
    expect(menuSource).toContain(`.id("${action}")`)
    expect(normalizedMenuSource).toContain(`.accelerator("${accelerator.toLowerCase()}")`)
  }
}

describe('format shortcut bindings', () => {
  it('should keep exported format actions aligned with accelerator declarations', () => {
    expect(new Set(FORMAT_SHORTCUT_ACTIONS)).toEqual(new Set(Object.keys(FORMAT_MENU_ACCELERATORS)))
  })

  it('should match Rust format menu accelerators', () => {
    expectAcceleratorsToMatch(FORMAT_MENU_ACCELERATORS)
  })

  it('should recognize modified number keys across keyboard layouts', () => {
    const colors = [
      'format_text_color_red',
      'format_text_color_orange',
      'format_text_color_yellow',
      'format_text_color_green',
      'format_text_color_cyan',
      'format_text_color_blue',
      'format_text_color_purple',
    ]

    colors.forEach((action, index) => {
      const digit = index + 1
      const binding = FORMAT_SHORTCUT_BINDINGS.find((item) => item.action === action)
      expect(binding).toBeDefined()

      const event = {
        altKey: true,
        shiftKey: false,
        code: `Digit${digit}`,
      } as KeyboardEvent
      expect(binding?.matches(event, String(digit))).toBe(true)
    })
  })
})

describe('global shortcut accelerators', () => {
  it('should match Rust global menu accelerators', () => {
    expectAcceleratorsToMatch(GLOBAL_MENU_ACCELERATORS)
  })
})
