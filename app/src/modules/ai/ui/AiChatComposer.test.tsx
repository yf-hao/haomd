import { createRef, type ReactNode, type RefObject } from 'react'
import { fireEvent, render, screen, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiChatComposer, type AiChatComposerHandle } from './AiChatComposer'
import { I18nProvider } from '../../i18n/I18nContext'

function renderWithI18n(node: ReactNode) {
  return render(
    <I18nProvider value={{ languageMode: 'zh-CN', resolvedLanguage: 'zh-CN', ready: true }}>
      {node}
    </I18nProvider>,
  )
}

describe('AiChatComposer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('exposes the textarea through ref and auto-resizes it on input', async () => {
    const inputRef = createRef<HTMLTextAreaElement>() as RefObject<HTMLTextAreaElement>
    const onSubmit = vi.fn()
    const onInputKeyDown = vi.fn()

    renderWithI18n(
      <AiChatComposer
        loading={false}
        onSubmit={onSubmit}
        onInputKeyDown={onInputKeyDown}
        inputRef={inputRef}
        pendingAttachmentsLength={0}
        onStop={() => {}}
      />,
    )

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(inputRef.current).toBe(textarea)

    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      value: 180,
    })

    await act(async () => {
      fireEvent.change(textarea, {
        target: { value: 'hello world', selectionStart: 11 },
      })
      await vi.advanceTimersByTimeAsync(50)
    })

    expect(textarea.style.height).toBe('120px')
  })

  it('commits the finalized composition text after composition ends', async () => {
    const inputRef = createRef<HTMLTextAreaElement>() as RefObject<HTMLTextAreaElement>
    const composerHandleRef = createRef<AiChatComposerHandle>()
    const onDraftChange = vi.fn()

    renderWithI18n(
      <AiChatComposer
        loading={false}
        onSubmit={() => {}}
        onInputKeyDown={() => {}}
        inputRef={inputRef}
        composerHandleRef={composerHandleRef}
        onDraftChange={onDraftChange}
        pendingAttachmentsLength={0}
        onStop={() => {}}
      />,
    )

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    await act(async () => {
      fireEvent.compositionStart(textarea)
      fireEvent.input(textarea, {
        target: { value: 'ni', selectionStart: 2 },
      })
    })

    expect(composerHandleRef.current?.getDraft()).toBe('')
    expect(onDraftChange).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.compositionEnd(textarea, { data: '你' })
      fireEvent.input(textarea, {
        target: { value: '你', selectionStart: 1 },
      })
    })

    expect(onDraftChange).toHaveBeenCalledTimes(1)
    expect(composerHandleRef.current?.getDraft()).toBe('你')
  })

  it('traces the events triggered by a normal key press and a composition commit', async () => {
    const inputRef = createRef<HTMLTextAreaElement>() as RefObject<HTMLTextAreaElement>
    const composerHandleRef = createRef<AiChatComposerHandle>()
    const onDraftChange = vi.fn()
    const onInputKeyDown = vi.fn()
    const trace: string[] = []

    renderWithI18n(
      <AiChatComposer
        loading={false}
        onSubmit={() => {}}
        onInputKeyDown={onInputKeyDown}
        inputRef={inputRef}
        composerHandleRef={composerHandleRef}
        onDraftChange={onDraftChange}
        pendingAttachmentsLength={0}
        onStop={() => {}}
      />,
    )

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    const eventTypes = ['keydown', 'keyup', 'compositionstart', 'compositionend', 'input']
    for (const type of eventTypes) {
      textarea.addEventListener(type, () => {
        trace.push(type)
      })
    }

    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'a', code: 'KeyA' })
      fireEvent.input(textarea, { target: { value: 'a', selectionStart: 1 } })
      fireEvent.keyUp(textarea, { key: 'a', code: 'KeyA' })
    })

    expect(onInputKeyDown).toHaveBeenCalledTimes(1)
    expect(onDraftChange).toHaveBeenCalledTimes(1)
    expect(composerHandleRef.current?.getDraft()).toBe('a')

    await act(async () => {
      fireEvent.compositionStart(textarea)
      fireEvent.input(textarea, { target: { value: 'ni', selectionStart: 2 } })
      fireEvent.compositionEnd(textarea, { data: '你' })
      fireEvent.input(textarea, { target: { value: '你', selectionStart: 1 } })
    })

    expect(composerHandleRef.current?.getDraft()).toBe('你')
    expect(onDraftChange).toHaveBeenCalledTimes(2)
    expect(trace).toEqual([
      'keydown',
      'input',
      'keyup',
      'compositionstart',
      'input',
      'compositionend',
      'input',
    ])
  })
})
