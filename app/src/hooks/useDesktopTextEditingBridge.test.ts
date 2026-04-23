import { renderHook, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDesktopTextEditingBridge } from './useDesktopTextEditingBridge'
import { onNativePaste, onNativePasteError } from '../modules/platform/clipboardEvents'

vi.mock('../modules/platform/clipboardEvents', () => ({
  onNativePaste: vi.fn(),
  onNativePasteError: vi.fn(),
}))

describe('useDesktopTextEditingBridge', () => {
  let pasteHandler: ((text: string) => void) | null = null
  let pasteErrorHandler: ((message: string) => void) | null = null

  beforeEach(() => {
    pasteHandler = null
    pasteErrorHandler = null
    vi.clearAllMocks()

    vi.mocked(onNativePaste).mockImplementation((handler) => {
      pasteHandler = handler
      return vi.fn()
    })

    vi.mocked(onNativePasteError).mockImplementation((handler) => {
      pasteErrorHandler = handler
      return vi.fn()
    })

    document.body.innerHTML = ''
  })

  it('should insert native paste text into the active editable element', () => {
    const textarea = document.createElement('textarea')
    textarea.value = 'hello world'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.setSelectionRange(6, 11)

    const inputSpy = vi.fn()
    textarea.addEventListener('input', inputSpy)

    renderHook(() =>
      useDesktopTextEditingBridge({
        enabled: true,
      }),
    )

    expect(pasteHandler).toBeTypeOf('function')

    act(() => {
      pasteHandler?.('codex')
    })

    expect(textarea.value).toBe('hello codex')
    expect(textarea.selectionStart).toBe(11)
    expect(textarea.selectionEnd).toBe(11)
    expect(inputSpy).toHaveBeenCalledTimes(1)
  })

  it('should use fallback when active element is not an editable input', () => {
    const fallback = vi.fn()
    const div = document.createElement('div')
    div.tabIndex = 0
    document.body.appendChild(div)
    div.focus()

    renderHook(() =>
      useDesktopTextEditingBridge({
        enabled: true,
        onPasteFallback: fallback,
      }),
    )

    act(() => {
      pasteHandler?.('fallback text')
    })

    expect(fallback).toHaveBeenCalledWith('fallback text')
  })

  it('should forward native paste errors', () => {
    const errorSpy = vi.fn()

    renderHook(() =>
      useDesktopTextEditingBridge({
        enabled: true,
        onPasteError: errorSpy,
      }),
    )

    act(() => {
      pasteErrorHandler?.('paste failed')
    })

    expect(errorSpy).toHaveBeenCalledWith('paste failed')
  })

  it('should stop propagation for desktop text editing shortcuts', () => {
    const { result } = renderHook(() =>
      useDesktopTextEditingBridge({
        enabled: true,
      }),
    )

    const stopPropagation = vi.fn()
    act(() => {
      result.current.handleKeyDownCapture({
        key: 'v',
        ctrlKey: true,
        metaKey: false,
        stopPropagation,
      } as never)
    })

    expect(stopPropagation).toHaveBeenCalledTimes(1)
  })

  it('should ignore unrelated key presses', () => {
    const { result } = renderHook(() =>
      useDesktopTextEditingBridge({
        enabled: true,
      }),
    )

    const stopPropagation = vi.fn()
    act(() => {
      result.current.handleKeyDownCapture({
        key: 'k',
        ctrlKey: true,
        metaKey: false,
        stopPropagation,
      } as never)
    })

    expect(stopPropagation).not.toHaveBeenCalled()
  })
})
