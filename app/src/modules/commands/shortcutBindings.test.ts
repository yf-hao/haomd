import { describe, expect, it } from 'vitest'
import {
  FORMAT_MENU_ACCELERATORS,
  FORMAT_SHORTCUT_ACTIONS,
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
})

describe('global shortcut accelerators', () => {
  it('should match Rust global menu accelerators', () => {
    expectAcceleratorsToMatch(GLOBAL_MENU_ACCELERATORS)
  })
})
