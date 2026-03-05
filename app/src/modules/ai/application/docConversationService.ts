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
import { readFile, writeFile } from '../../files/service'
import { getDirKeyFromDocPath } from '../domain/docPathUtils'

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

// ===== WorkspaceId + 稳定 docPath key 映射 =====

type WorkspaceConfig = {
  id: string
}

const WORKSPACE_CONFIG_BASENAME = '.haomd-workspace.json'
const workspaceIdCache = new Map<string, string>()

function normalizeDirPath(dir: string): string {
  if (!dir) return ''
  const normalized = dir.replace(/\\/g, '/').trim()
  if (!normalized) return ''
  if (normalized === '/') return '/'
  return normalized.replace(/\/+$/, '')
}

function joinPath(dir: string, basename: string): string {
  const normalizedDir = normalizeDirPath(dir)
  if (!normalizedDir || normalizedDir === '/') {
    return `/${basename}`
  }
  return `${normalizedDir}/${basename}`
}

function getParentDir(dir: string): string | null {
  const normalized = normalizeDirPath(dir)
  if (!normalized || normalized === '/') return null
  const idx = normalized.lastIndexOf('/')
  if (idx <= 0) return '/'
  return normalized.slice(0, idx)
}

function genWorkspaceId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `ws_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

async function readWorkspaceConfig(configPath: string): Promise<WorkspaceConfig | null> {
  try {
    const resp = await readFile(configPath)
    if (!resp.ok) {
      if (resp.error.code !== 'NOT_FOUND') {
        console.warn('[docConversationService] readWorkspaceConfig error', resp.error)
      }
      return null
    }
    const raw = resp.data.content
    const parsed = JSON.parse(raw) as any
    const id = typeof parsed?.id === 'string' ? parsed.id.trim() : ''
    if (!id) return null
    return { id }
  } catch (e) {
    console.warn('[docConversationService] readWorkspaceConfig parse error', e)
    return null
  }
}

async function writeWorkspaceConfig(configPath: string, id: string): Promise<void> {
  try {
    const content = JSON.stringify({ id }, null, 2)
    const resp = await writeFile({ path: configPath, content })
    if (!resp.ok) {
      console.warn('[docConversationService] writeWorkspaceConfig failed', resp.error)
    }
  } catch (e) {
    console.error('[docConversationService] writeWorkspaceConfig error', e)
  }
}

async function resolveWorkspaceIdForDir(dir: string): Promise<{ workspaceId: string; workspaceRoot: string } | null> {
  let current = normalizeDirPath(dir)
  if (!current || current === '/') return null

  while (true) {
    const configPath = joinPath(current, WORKSPACE_CONFIG_BASENAME)
    const cached = workspaceIdCache.get(configPath)
    if (cached) {
      return { workspaceId: cached, workspaceRoot: current }
    }
    const cfg = await readWorkspaceConfig(configPath)
    if (cfg && cfg.id) {
      workspaceIdCache.set(configPath, cfg.id)
      return { workspaceId: cfg.id, workspaceRoot: current }
    }
    const parent = getParentDir(current)
    if (!parent || parent === current || parent === '/') break
    current = parent
  }

  return null
}

async function ensureWorkspaceIdForDir(dir: string): Promise<{ workspaceId: string; workspaceRoot: string } | null> {
  const existing = await resolveWorkspaceIdForDir(dir)
  if (existing) return existing

  const rootDir = normalizeDirPath(dir)
  if (!rootDir || rootDir === '/') return null
  const configPath = joinPath(rootDir, WORKSPACE_CONFIG_BASENAME)
  const newId = genWorkspaceId()
  await writeWorkspaceConfig(configPath, newId)
  workspaceIdCache.set(configPath, newId)
  return { workspaceId: newId, workspaceRoot: rootDir }
}

function getLastDirName(dir: string): string {
  const normalized = normalizeDirPath(dir)
  if (!normalized || normalized === '/') return '/'
  const parts = normalized.split('/')
  return parts[parts.length - 1] || '/'
}

function getLastTwoDirNames(dir: string): string {
  const normalized = normalizeDirPath(dir)
  if (!normalized || normalized === '/') return '/'
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 0) return '/'
  if (parts.length === 1) return parts[0]
  const lastTwo = parts.slice(-2)
  return lastTwo.join('/')
}

/**
 * 将外部传入的 docPath（可以是文件路径或目录路径）映射为稳定 key：
 * - 先通过 getDirKeyFromDocPath 归一到父目录；
 * - 再使用 workspaceId + 「父目录名/当前目录名」两级路径 作为真正的存盘 docPath；
 * - 若 workspaceId 无法解析，则退回到「父目录名/当前目录名」。
 */
async function toStableDocPathKey(rawDocPath: string): Promise<string> {
  const dirKey = getDirKeyFromDocPath(rawDocPath) ?? rawDocPath
  const dir = normalizeDirPath(dirKey)
  if (!dir || dir === '/') {
    // 根目录：仍然使用原始路径的最后一级名称，避免破坏旧数据
    return getLastDirName(rawDocPath)
  }

  try {
    const info = await ensureWorkspaceIdForDir(dir)
    const lastTwo = getLastTwoDirNames(dir)
    if (!info) {
      return lastTwo
    }
    return `${info.workspaceId}::${lastTwo}`
  } catch (e) {
    console.error('[docConversationService] toStableDocPathKey failed', e)
    return getLastTwoDirNames(dir)
  }
}

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
      const stableKey = await toStableDocPathKey(docPath)
      const records = getCache()
      return (
        records.find((r) => r.docPath === stableKey) ??
        records.find((r) => r.docPath === docPath) ??
        null
      )
    },

    async upsertFromState(options): Promise<void> {
      const { docPath, state, providerType, modelName, difyConversationId } = options
      await ensureLoaded()
      const records = getCache()
      const stableKey = await toStableDocPathKey(docPath)
      const nextMessages = toDocMessages(stableKey, state, providerType, modelName)
      const now = Date.now()

      const idx = records.findIndex((r) => r.docPath === stableKey || r.docPath === docPath)

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
          docPath: stableKey,
          lastActiveAt: now,
          difyConversationId: difyConversationId ?? existing.difyConversationId,
          messages: mergedMessages,
        }
      } else {
        records.push({
          docPath: stableKey,
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
      const stableKey = await toStableDocPathKey(docPath)
      const idx = records.findIndex((r) => r.docPath === stableKey || r.docPath === docPath)

      if (idx >= 0) {
        records[idx] = {
          docPath: stableKey,
          sessionId: genSessionId(),
          lastActiveAt: now,
          difyConversationId: undefined,
          messages: [],
        }
      } else {
        records.push({
          docPath: stableKey,
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
      const stableKey = await toStableDocPathKey(docPath)
      const idx = records.findIndex((r) => r.docPath === stableKey || r.docPath === docPath)

      if (idx < 0) {
        // 没有对应文档记录，直接返回
        return
      }

      try {
        const existing = records[idx]
        const cfg = await loadCompressionConfig().catch(() => defaultCompressionConfig)
        const summaryCreatedAfter = Date.now()
        const compressed = await conversationCompressor.compress(existing, cfg)
        const merged: DocConversationRecord = {
          ...compressed,
          docPath: stableKey,
        }
        records[idx] = merged
        await persist(records)
        emitDocConversationEvent({ type: 'compressed', docPath })

        // 在压缩完成后，根据此次生成的摘要消息构建 SessionDigest 并入队
        try {
          enqueueSessionDigestFromCompressedRecord(merged, { summaryCreatedAfter })
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
