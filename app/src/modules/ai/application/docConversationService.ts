import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../../platform/backendTypes'
import type { ProviderType } from '../domain/types'
import type { ConversationState } from '../domain/chatSession'
import type {
  DocConversationRecord,
  DocConversationMessage,
  ConversationIndexEntry,
  DocConversationKind,
} from '../domain/docConversations'
import { createConversationCompressor, createLLMSummaryProvider, loadCompressionConfig, defaultCompressionConfig } from './conversationCompression'
import { enqueueSessionDigestFromCompressedRecord } from '../globalMemory/sessionDigestQueue'

// 后端 JSON 结构目前与领域模型一致，单独起别名便于未来扩展
export type DocConversationRecordCfg = DocConversationRecord

export type DocConversationEvent =
  | { type: 'cleared'; docPath: string; kind?: DocConversationKind }
  | { type: 'compressed'; docPath: string; kind?: DocConversationKind }
  | { type: 'updated'; docPath: string; kind?: DocConversationKind }

type DocConversationEventListener = (event: DocConversationEvent) => void

const docConversationEventListeners = new Set<DocConversationEventListener>()

function emitDocConversationEvent(event: DocConversationEvent): void {
  if (docConversationEventListeners.size === 0) return
  for (const listener of docConversationEventListeners) {
    try {
      listener(event)
    } catch (e) {
      console.error('[docConversationService] listener error', e)
    }
  }
}

export function subscribeDocConversationEvents(listener: DocConversationEventListener): () => void {
  docConversationEventListeners.add(listener)
  return () => {
    docConversationEventListeners.delete(listener)
  }
}

function genSessionId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function toDocMessages(
  docPath: string,
  state: ConversationState,
  providerType: ProviderType,
  modelName: string,
): DocConversationMessage[] {
  const now = Date.now()

  return state.viewMessages
    .filter((m) => !m.hidden)
    .map((m): DocConversationMessage => ({
      id: m.id,
      docPath,
      timestamp: now,
      role: m.role,
      content: m.content,
      meta: {
        providerType,
        modelName,
      },
    }))
}

let recordsCache: DocConversationRecord[] | null = null
let loaded = false
let loadingPromise: Promise<void> | null = null

const summaryProvider = createLLMSummaryProvider()
const conversationCompressor = createConversationCompressor(summaryProvider)

async function ensureLoaded(): Promise<void> {
  if (loaded) return
  if (loadingPromise) return loadingPromise

  loadingPromise = (async () => {
    try {
      const resp = await invoke<BackendResult<DocConversationRecordCfg[]>>('load_doc_conversations')
      if ('Ok' in resp) {
        recordsCache = resp.Ok.data ?? []
      } else {
        console.warn('[docConversationService] load_doc_conversations error', resp.Err.error)
        recordsCache = []
      }
    } finally {
      loaded = true
      loadingPromise = null
    }
  })()

  return loadingPromise
}

function getCache(): DocConversationRecord[] {
  if (!recordsCache) recordsCache = []
  return recordsCache
}

async function persist(records: DocConversationRecord[]): Promise<void> {
  await invoke('save_doc_conversations', { records })
}

export type DocConversationService = {
  loadAll(): Promise<DocConversationRecord[]>
  getByDocPath(docPath: string, kind?: DocConversationKind): Promise<DocConversationRecord | null>
  upsertFromState(options: {
    docPath: string
    kind?: DocConversationKind
    state: ConversationState
    providerType: ProviderType
    modelName: string
    difyConversationId?: string
  }): Promise<void>
  clearByDocPath(docPath: string, kind?: DocConversationKind): Promise<void>
  compressByDocPath(docPath: string, kind?: DocConversationKind): Promise<void>
  getIndex(): Promise<ConversationIndexEntry[]>
}

export function createDocConversationService(): DocConversationService {
  return {
    async loadAll(): Promise<DocConversationRecord[]> {
      await ensureLoaded()
      return getCache()
    },

    async getByDocPath(docPath: string): Promise<DocConversationRecord | null> {
      await ensureLoaded()
      return getCache().find((r) => r.docPath === docPath) ?? null
    },

    async upsertFromState(options): Promise<void> {
      const { docPath, state, providerType, modelName, difyConversationId } = options
      await ensureLoaded()
      const records = getCache()
      const nextMessages = toDocMessages(docPath, state, providerType, modelName)
      const now = Date.now()

      const idx = records.findIndex((r) => r.docPath === docPath)

      if (idx >= 0) {
        const existing = records[idx]
        const byId = new Map<string, DocConversationMessage>()
        for (const m of existing.messages) {
          byId.set(m.id, m)
        }
        for (const m of nextMessages) {
          byId.set(m.id, m)
        }

        const mergedMessages = Array.from(byId.values()).sort((a, b) => a.timestamp - b.timestamp)

        records[idx] = {
          ...existing,
          lastActiveAt: now,
          difyConversationId: difyConversationId ?? existing.difyConversationId,
          messages: mergedMessages,
        }
      } else {
        records.push({
          docPath,
          sessionId: genSessionId(),
          lastActiveAt: now,
          difyConversationId,
          messages: nextMessages,
        })
      }

      await persist(records)
      emitDocConversationEvent({ type: 'updated', docPath })
    },

    async clearByDocPath(docPath: string): Promise<void> {
      await ensureLoaded()
      const records = getCache()
      const now = Date.now()
      const idx = records.findIndex((r) => r.docPath === docPath)

      if (idx >= 0) {
        records[idx] = {
          docPath,
          sessionId: genSessionId(),
          lastActiveAt: now,
          difyConversationId: undefined,
          messages: [],
        }
      } else {
        records.push({
          docPath,
          sessionId: genSessionId(),
          lastActiveAt: now,
          difyConversationId: undefined,
          messages: [],
        })
      }

      await persist(records)
      emitDocConversationEvent({ type: 'cleared', docPath })
    },

    async compressByDocPath(docPath: string): Promise<void> {
      await ensureLoaded()
      const records = getCache()
      const idx = records.findIndex((r) => r.docPath === docPath)

      if (idx < 0) {
        // 没有对应文档记录，直接返回
        return
      }

      try {
        const existing = records[idx]
        const cfg = await loadCompressionConfig().catch(() => defaultCompressionConfig)
        const summaryCreatedAfter = Date.now()
        const compressed = await conversationCompressor.compress(existing, cfg)
        records[idx] = compressed
        await persist(records)
        emitDocConversationEvent({ type: 'compressed', docPath })

        // 在压缩完成后，根据此次生成的摘要消息构建 SessionDigest 并入队
        try {
          enqueueSessionDigestFromCompressedRecord(compressed, { summaryCreatedAfter })
        } catch (digestError) {
          console.error('[docConversationService] enqueue SessionDigest failed', digestError)
        }
      } catch (e) {
        // 保持与之前占位实现类似的容错行为，不向外抛出，只记录日志
        console.error('[docConversationService] compressByDocPath failed', e)
      }
    },

    async getIndex(): Promise<ConversationIndexEntry[]> {
      await ensureLoaded()
      return getCache().map<ConversationIndexEntry>((r) => ({
        docPath: r.docPath,
        sessionId: r.sessionId,
        lastActiveAt: r.lastActiveAt,
        hasDifyConversation: !!r.difyConversationId,
        messageCount: r.messages.length,
      }))
    },
  }
}

export const docConversationService: DocConversationService = createDocConversationService()
