import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { useNativePaste } from './useNativePaste'
import { readClipboardForPaste } from '../modules/platform/clipboardPasteService'
import {
  dispatchNativePasteImage,
  onNativePaste,
  onNativePasteError,
} from '../modules/platform/clipboardEvents'

vi.mock('../modules/platform/runtime', () => ({
  isTauriEnv: () => true,
}))

vi.mock('../modules/platform/clipboardPasteService', () => ({
  readClipboardForPaste: vi.fn(),
}))

vi.mock('../modules/platform/clipboardEvents', () => ({
  dispatchNativePasteImage: vi.fn(),
  onNativePaste: vi.fn(() => vi.fn()),
  onNativePasteError: vi.fn(() => vi.fn()),
}))

function createEditorView() {
  const dom = document.createElement('div')
  const content = document.createElement('textarea')
  dom.appendChild(content)
  document.body.appendChild(dom)

  const transaction = { changes: [] }
  const replaceSelection = vi.fn(() => ({ changes: [{ from: 0, insert: 'text' }] }))
  const update = vi.fn(() => transaction)
  const dispatch = vi.fn()
  const view = {
    dom,
    state: { replaceSelection, update },
    dispatch,
  } as unknown as EditorView

  return { content, dispatch, dom, replaceSelection, transaction, update, view }
}

describe('useNativePaste', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    })
    vi.mocked(onNativePaste).mockReturnValue(vi.fn())
    vi.mocked(onNativePasteError).mockReturnValue(vi.fn())
  })

  it('reads and inserts clipboard text on Windows Ctrl+V inside the editor', async () => {
    vi.mocked(readClipboardForPaste).mockResolvedValue({ kind: 'text', text: 'hello' })
    const editor = createEditorView()
    editor.content.focus()

    renderHook(() => useNativePaste({ current: editor.view }, vi.fn()))

    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'v',
      ctrlKey: true,
    })
    act(() => {
      editor.content.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
    await waitFor(() => expect(editor.dispatch).toHaveBeenCalledWith(editor.transaction))
    expect(editor.replaceSelection).toHaveBeenCalledWith('hello')
    expect(editor.update).toHaveBeenCalledWith(expect.objectContaining({
      userEvent: 'input.paste',
      scrollIntoView: true,
    }))
  })

  it('dispatches the native image event on Windows Ctrl+V', async () => {
    vi.mocked(readClipboardForPaste).mockResolvedValue({ kind: 'image' })
    const editor = createEditorView()
    editor.content.focus()

    renderHook(() => useNativePaste({ current: editor.view }, vi.fn()))

    act(() => {
      editor.content.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'v',
        ctrlKey: true,
      }))
    })

    await waitFor(() => expect(dispatchNativePasteImage).toHaveBeenCalledTimes(1))
    expect(editor.dispatch).not.toHaveBeenCalled()
  })

  it('does not apply delayed clipboard content to a replacement editor view', async () => {
    let resolveClipboard: ((content: { kind: 'text'; text: string }) => void) | undefined
    vi.mocked(readClipboardForPaste).mockImplementation(
      () => new Promise((resolve) => {
        resolveClipboard = resolve
      }),
    )
    const firstEditor = createEditorView()
    const replacementEditor = createEditorView()
    const editorRef = { current: firstEditor.view }
    firstEditor.content.focus()

    renderHook(() => useNativePaste(
      editorRef,
      vi.fn(),
      undefined,
      () => editorRef.current,
    ))

    act(() => {
      firstEditor.content.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'v',
        ctrlKey: true,
      }))
    })

    editorRef.current = replacementEditor.view
    replacementEditor.content.focus()
    resolveClipboard?.({ kind: 'text', text: 'late' })

    await waitFor(() => expect(readClipboardForPaste).toHaveBeenCalledTimes(1))
    expect(firstEditor.dispatch).not.toHaveBeenCalled()
    expect(replacementEditor.dispatch).not.toHaveBeenCalled()
  })

  it('does not intercept paste when focus is outside the editor', () => {
    const editor = createEditorView()
    const outside = document.createElement('textarea')
    document.body.appendChild(outside)
    outside.focus()

    renderHook(() => useNativePaste({ current: editor.view }, vi.fn()))

    const event = new Event('paste', { bubbles: true, cancelable: true })
    act(() => {
      editor.dom.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(false)
    expect(readClipboardForPaste).not.toHaveBeenCalled()
  })
})
