// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAiChatSession } from './useAiChatSession'

const mocks = vi.hoisted(() => ({
  createChatSession: vi.fn(),
  loadAiSettingsState: vi.fn(),
}))

vi.mock('../../application/chatSessionService', () => ({
  createChatSession: mocks.createChatSession,
}))

vi.mock('../../application/docConversationService', () => ({
  docConversationService: {
    getByDocPath: vi.fn().mockResolvedValue(null),
  },
  subscribeDocConversationEvents: vi.fn(() => () => {}),
}))

vi.mock('../../application/sessionAutoTitleService', () => ({
  ensureSessionAutoTitle: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../config/aiSessionsRepo', () => ({
  loadSession: vi.fn().mockResolvedValue(null),
  saveSession: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../config/aiSettingsRepo', () => ({
  loadAiSettingsState: mocks.loadAiSettingsState,
}))

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  let reject!: Deferred<T>['reject']
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function createMockSession(providerType: 'dify' | 'openai' = 'dify') {
  return {
    sendUserMessage: vi.fn().mockResolvedValue(undefined),
    sendVisionTask: vi.fn().mockResolvedValue(undefined),
    uploadAttachment: vi.fn().mockResolvedValue({
      id: 'uploaded-1',
      kind: 'image',
      name: 'pasted.png',
      mimeType: 'image/png',
      sourceUrl: 'data:image/png;base64,abc',
    }),
    getState: vi.fn(() => ({
      engineHistory: [],
      viewMessages: [],
      entryMode: 'chat',
    })),
    getSystemPromptInfo: vi.fn(() => ({
      systemPrompt: '',
      roles: [],
      activeRoleId: null,
    })),
    getProviderType: vi.fn(() => providerType),
    getActiveModelId: vi.fn(() => 'model-1'),
    setActiveRole: vi.fn().mockResolvedValue(undefined),
    setActiveModel: vi.fn().mockResolvedValue(undefined),
    stopRunningStream: vi.fn(),
    stopAndTruncate: vi.fn(),
    dispose: vi.fn(),
    getProviderContext: vi.fn(() => null),
  }
}

describe('useAiChatSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadAiSettingsState.mockResolvedValue({ providers: [] })
  })

  it('clears Dify attachments immediately and restores them when sending fails', async () => {
    const session = createMockSession('dify')
    const deferred = createDeferred<void>()
    session.sendUserMessage.mockReturnValueOnce(deferred.promise)
    mocks.createChatSession.mockResolvedValue(session)

    const { result } = renderHook(() =>
      useAiChatSession({
        sessionKey: 'temp-session',
        entryMode: 'chat',
        open: true,
      }),
    )

    await waitFor(() => {
      expect(result.current.providerType).toBe('dify')
    })

    await act(async () => {
      await result.current.uploadFiles([new File(['img'], 'pasted.png', { type: 'image/png' })])
    })

    expect(result.current.pendingAttachments).toHaveLength(1)

    let sendPromise!: Promise<void>
    act(() => {
      sendPromise = result.current.sendMessage('describe this image')
    })

    expect(result.current.pendingAttachments).toHaveLength(0)
    expect(session.sendUserMessage).toHaveBeenCalledWith(
      'describe this image',
      expect.objectContaining({
        attachments: [expect.objectContaining({ id: 'uploaded-1' })],
      }),
    )

    await act(async () => {
      deferred.reject(new Error('upload send failed'))
      await sendPromise
    })

    expect(result.current.pendingAttachments).toHaveLength(1)
    expect(result.current.error?.message).toBe('upload send failed')
  })

  it('clears pasted vision image immediately and restores it when sending fails', async () => {
    const session = createMockSession('openai')
    const deferred = createDeferred<void>()
    session.sendVisionTask.mockReturnValueOnce(deferred.promise)
    mocks.createChatSession.mockResolvedValue(session)

    const { result } = renderHook(() =>
      useAiChatSession({
        sessionKey: 'temp-session',
        entryMode: 'chat',
        open: true,
      }),
    )

    await waitFor(() => {
      expect(result.current.providerType).toBe('openai')
    })

    const clearAttachedImage = vi.fn()
    const restoreAttachedImage = vi.fn()
    const dataUrl = 'data:image/png;base64,abc'

    let sendPromise!: Promise<void>
    act(() => {
      sendPromise = result.current.sendMessage('', {
        attachedImageDataUrl: dataUrl,
        onClearAttachedImage: clearAttachedImage,
        onRestoreAttachedImage: restoreAttachedImage,
      })
    })

    expect(clearAttachedImage).toHaveBeenCalledTimes(1)
    expect(session.sendVisionTask).toHaveBeenCalledWith(
      {
        prompt: '请详细识别并描述这张图片中的内容。如果图片中包含文字、公式、表格、题目或文档，请先完整提取关键信息，再直接回答。若图片信息不足，请明确说明。',
        images: [{ kind: 'data_url', dataUrl }],
      },
      { hideInView: false },
    )

    await act(async () => {
      deferred.reject(new Error('vision send failed'))
      await sendPromise
    })

    expect(restoreAttachedImage).toHaveBeenCalledWith(dataUrl)
    expect(result.current.error?.message).toBe('vision send failed')
  })
})
