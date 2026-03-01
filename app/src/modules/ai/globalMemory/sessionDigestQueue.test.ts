import { describe, it, expect, vi, beforeEach } from 'vitest'
import { enqueueSessionDigestFromCompressedRecord, enqueueSessionDigestFromChat, enqueueSessionDigestFromChatSummary } from './sessionDigestQueue'

vi.mock('./repo', () => {
  const loadPendingSessionDigestsMock = vi.fn()
  const savePendingSessionDigestsMock = vi.fn()

  ;(globalThis as any).__loadPendingSessionDigestsMock = loadPendingSessionDigestsMock
  ;(globalThis as any).__savePendingSessionDigestsMock = savePendingSessionDigestsMock

  return {
    loadPendingSessionDigests: loadPendingSessionDigestsMock,
    savePendingSessionDigests: savePendingSessionDigestsMock,
  }
})

const getRepoMocks = () => {
  const g = globalThis as any
  return {
    loadPendingSessionDigestsMock: g.__loadPendingSessionDigestsMock as any,
    savePendingSessionDigestsMock: g.__savePendingSessionDigestsMock as any,
  }
}

describe('sessionDigestQueue enqueueSessionDigestFromCompressedRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should do nothing when there is no summary messages', () => {
    const record: any = {
      docPath: '/doc.md',
      messages: [
        { id: '1', content: 'a', timestamp: 1, meta: { summaryLevel: 0 } },
      ],
    }

    enqueueSessionDigestFromCompressedRecord(record)

    const { loadPendingSessionDigestsMock, savePendingSessionDigestsMock } = getRepoMocks()
    expect(loadPendingSessionDigestsMock).not.toHaveBeenCalled()
    expect(savePendingSessionDigestsMock).not.toHaveBeenCalled()
  })

  it('should build digest using coveredTimeRange when available', () => {
    const record: any = {
      docPath: '/doc.md',
      messages: [
        {
          id: '1',
          content: 's1',
          timestamp: 1000,
          meta: { summaryLevel: 1, coveredTimeRange: { from: 10, to: 20 } },
        },
        {
          id: '2',
          content: 's2',
          timestamp: 2000,
          meta: { summaryLevel: 2, coveredTimeRange: { from: 30, to: 40 } },
        },
      ],
    }

    const { loadPendingSessionDigestsMock, savePendingSessionDigestsMock } = getRepoMocks()
    loadPendingSessionDigestsMock.mockReturnValueOnce([])

    enqueueSessionDigestFromCompressedRecord(record)

    expect(loadPendingSessionDigestsMock).toHaveBeenCalled()
    expect(savePendingSessionDigestsMock).toHaveBeenCalledTimes(1)
    const [pending] = savePendingSessionDigestsMock.mock.calls[0]
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({
      docPath: '/doc.md',
      period: { from: 10, to: 40 },
      summaries: ['s1', 's2'],
      source: 'conversation-compress',
    })
  })

  it('should filter summaries by summaryCreatedAfter and use timestamps when no ranges', () => {
    const record: any = {
      docPath: '/doc.md',
      messages: [
        {
          id: '1',
          content: 'old',
          timestamp: 1000,
          meta: { summaryLevel: 1 },
        },
        {
          id: '2',
          content: 'new',
          timestamp: 2000,
          meta: { summaryLevel: 1 },
        },
      ],
    }

    const { loadPendingSessionDigestsMock, savePendingSessionDigestsMock } = getRepoMocks()
    loadPendingSessionDigestsMock.mockReturnValueOnce([])

    enqueueSessionDigestFromCompressedRecord(record, { summaryCreatedAfter: 1500 })

    const [pending] = savePendingSessionDigestsMock.mock.calls[0]
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({
      summaries: ['new'],
      period: { from: 2000, to: 2000 },
    })
  })
})

describe('sessionDigestQueue enqueueSessionDigestFromChat & enqueueSessionDigestFromChatSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('enqueueSessionDigestFromChat should append digest to pending list', () => {
    const existing = [
      {
        docPath: '/old.md',
        period: { from: 1, to: 2 },
        summaries: ['old'],
        source: 'conversation-compress',
      },
    ]

    const { loadPendingSessionDigestsMock, savePendingSessionDigestsMock } = getRepoMocks()
    loadPendingSessionDigestsMock.mockReturnValueOnce(existing)

    enqueueSessionDigestFromChat({
      docPath: '/new.md',
      summaries: ['s1', 's2'],
      periodFrom: 10,
      periodTo: 20,
    })

    expect(savePendingSessionDigestsMock).toHaveBeenCalledTimes(1)
    const [pending] = savePendingSessionDigestsMock.mock.calls[0]
    expect(pending).toHaveLength(2)
    expect(pending[1]).toMatchObject({
      docPath: '/new.md',
      period: { from: 10, to: 20 },
      summaries: ['s1', 's2'],
    })
  })

  it('enqueueSessionDigestFromChatSummary should wrap summary and delegate to chat variant', () => {
    const { loadPendingSessionDigestsMock, savePendingSessionDigestsMock } = getRepoMocks()
    loadPendingSessionDigestsMock.mockReturnValueOnce([])

    enqueueSessionDigestFromChatSummary({
      docPath: '/doc.md',
      summary: 'one',
      periodFrom: 5,
      periodTo: 15,
    })

    expect(savePendingSessionDigestsMock).toHaveBeenCalledTimes(1)
    const [pending] = savePendingSessionDigestsMock.mock.calls[0]
    expect(pending[0]).toMatchObject({
      docPath: '/doc.md',
      period: { from: 5, to: 15 },
      summaries: ['one'],
    })
  })
})
