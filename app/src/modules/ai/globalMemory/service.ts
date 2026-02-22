import type { ChatMessage } from '../domain/types'
import type { UiProvider } from '../settings'
import { loadAiSettingsState } from '../settings'
import { createStreamingClientFromSettings } from '../streamingClientFactory'
import type { GlobalMemoryItem, SessionDigest, UserProfile } from './types'
import { loadGlobalMemoryItems, loadUserProfile, saveGlobalMemoryItems, saveUserProfile } from './repo'

export type GlobalMemoryDelta = {
  profileDelta?: Partial<UserProfile> | null
  newItems?: GlobalMemoryItem[]
  updatedItems?: GlobalMemoryItem[]
  disableItemIds?: string[]
}

function pickDefaultProviderForGlobalMemory(
  state: Awaited<ReturnType<typeof loadAiSettingsState>>,
): UiProvider | null {
  if (!state.providers.length) {
    console.warn('[GlobalMemoryService] no providers configured, skip update')
    return null
  }
  const byDefault = state.providers.find((p) => p.id === state.defaultProviderId)
  return byDefault ?? state.providers[0]!
}

function buildSystemPromptForGlobalMemory(): string {
  const lines: string[] = []

  lines.push('你是一个“全局记忆分析助手”，负责根据多个文档会话的摘要来提炼用户的长期偏好、习惯与事实。')
  lines.push('你的输出必须是严格的 JSON，且只能包含一个对象，不要添加任何解释性文字、注释或 Markdown。')
  lines.push('JSON 结构类型如下（TypeScript 类型，仅用于说明，不需要原样输出）：')
  lines.push('type GlobalMemoryDelta = {')
  lines.push('  profileDelta?: Partial<UserProfile> | null')
  lines.push('  newItems?: GlobalMemoryItem[]')
  lines.push('  updatedItems?: GlobalMemoryItem[]')
  lines.push('  disableItemIds?: string[]')
  lines.push('}')
  lines.push('其中：')
  lines.push('- UserProfile 用于总结用户整体画像（summary / writingStyle / interests / languages / preferredModels）')
  lines.push('- GlobalMemoryItem 表达具体的偏好/习惯/事实/指令，每条有 id/type/title/content/weight/tags/pinned/disabled 等字段')
  lines.push('你的任务：')
  lines.push('1. 阅读输入的 SessionDigest（对话摘要）集合，理解用户的长期偏好、习惯、事实。')
  lines.push('2. 在此基础上，生成 profileDelta：对现有 UserProfile 的增量修改（如果没有需要修改的字段，可以给 null 或省略）。')
  lines.push('3. 生成 newItems：新的全局记忆条目。不要简单重复已有条目，尽量合并相似信息。')
  lines.push('4. 生成 updatedItems：对已有条目（通过 id 对应）的内容/权重/标签等更新。')
  lines.push('5. 对明显过时或与当前摘要矛盾的条目，将其 id 放入 disableItemIds（仅建议禁用，不是删除）。')
  lines.push('注意：')
  lines.push('- 不要改变 pinned 条目的语义，它们通常是用户手动固定的偏好。')
  lines.push('- 避免创建含糊、不稳定或一次性的记忆，只保留长期稳定的偏好与事实。')
  lines.push('- 文本字段请尽量使用简洁、明确的自然语言描述。')
  lines.push('最终只输出 GlobalMemoryDelta 对象本身，例如：{"profileDelta":{...},"newItems":[...],"updatedItems":[...],"disableItemIds":[...]}')

  return lines.join('\n')
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}...`
}

function buildUserPromptContent(input: {
  digests: SessionDigest[]
  currentProfile: UserProfile | null
  currentItems: GlobalMemoryItem[]
}): string {
  const { digests, currentProfile, currentItems } = input

  const safeDigests = digests.map((d) => ({
    docPath: d.docPath,
    period: d.period,
    summaries: d.summaries.map((s) => truncate(s, 800)),
    topics: d.topics ?? [],
  }))

  const slimProfile = currentProfile
    ? {
        summary: truncate(currentProfile.summary, 800),
        writingStyle: currentProfile.writingStyle,
        interests: currentProfile.interests,
        languages: currentProfile.languages,
        preferredModels: currentProfile.preferredModels ?? [],
      }
    : null

  const slimItems = currentItems.map((item) => ({
    id: item.id,
    type: item.type,
    title: item.title,
    content: truncate(item.content, 400),
    weight: item.weight,
    tags: item.tags ?? [],
    pinned: !!item.pinned,
    disabled: !!item.disabled,
    sourceDocs: item.sourceDocs,
  }))

  const payload = {
    digests: safeDigests,
    currentProfile: slimProfile,
    currentItems: slimItems,
  }

  const lines: string[] = []
  lines.push('下面是本次需要你分析的一批会话摘要（SessionDigest），以及当前已有的全局记忆状态。')
  lines.push('请根据这些信息，生成一个 GlobalMemoryDelta JSON 对象，用于更新用户画像和全局记忆。')
  lines.push('--- INPUT JSON START ---')
  lines.push(JSON.stringify(payload, null, 2))
  lines.push('--- INPUT JSON END ---')
  lines.push('再次强调：直接输出 GlobalMemoryDelta JSON 对象本身，不要加任何解释文字。')

  return lines.join('\n')
}

function applyDeltaToProfile(current: UserProfile | null, delta: GlobalMemoryDelta | null): UserProfile | null {
  if (!delta || !delta.profileDelta) return current

  const now = Date.now()
  const base: UserProfile =
    current ?? {
      id: 'user-profile',
      updatedAt: now,
      summary: '',
      writingStyle: '',
      interests: [],
      languages: [],
      preferredModels: [],
    }

  const next: UserProfile = {
    ...base,
    ...delta.profileDelta,
    updatedAt: now,
  }

  return next
}

function enrichTagsForGlobalMemoryItem(item: GlobalMemoryItem): GlobalMemoryItem {
  const tagsSet = new Set<string>(item.tags ?? [])

  const text = `${item.title ?? ''} ${item.content ?? ''}`.toLowerCase()
  const hasStudySignal =
    tagsSet.has('study') ||
    /study|learning|exam|homework|lecture|course|课程|学习|复习|备考/.test(text) ||
    (item.sourceDocs && item.sourceDocs.some((p) => /\/study\//i.test(p)))

  if (hasStudySignal) {
    tagsSet.add('study')
  }

  return {
    ...item,
    tags: Array.from(tagsSet),
  }
}

function applyDeltaToItems(current: GlobalMemoryItem[], delta: GlobalMemoryDelta | null): GlobalMemoryItem[] {
  if (!delta) return current

  const byId = new Map<string, GlobalMemoryItem>()
  for (const item of current) {
    byId.set(item.id, item)
  }

  const updatedItems = delta.updatedItems ?? []
  for (const updated of updatedItems) {
    const existing = byId.get(updated.id)
    if (!existing) {
      byId.set(updated.id, updated)
      continue
    }

    const merged: GlobalMemoryItem = {
      ...existing,
      ...updated,
    }

    // 保护 pinned 条目：不自动取消 pin，且不降低权重
    if (existing.pinned) {
      merged.pinned = true
      if (typeof merged.weight === 'number' && merged.weight < existing.weight) {
        merged.weight = existing.weight
      }
    }

    byId.set(merged.id, merged)
  }

  const now = Date.now()
  const newItems = (delta.newItems ?? []).map((item, index) => {
    const id = item.id && !byId.has(item.id) ? item.id : `gm_${now}_${index}_${Math.random().toString(36).slice(2, 6)}`
    const createdAt = item.createdAt ?? now
    const updatedAt = item.updatedAt ?? now

    return {
      ...item,
      id,
      createdAt,
      updatedAt,
    }
  })

  for (const item of newItems) {
    const existing = byId.get(item.id)
    if (!existing) {
      byId.set(item.id, item)
      continue
    }

    // 如果新条目的内容与已有条目高度相似，可以简单合并权重与来源
    if (item.content === existing.content) {
      const merged: GlobalMemoryItem = {
        ...existing,
        weight: Math.max(existing.weight, item.weight),
        sourceDocs: Array.from(new Set([...existing.sourceDocs, ...item.sourceDocs])),
        sourceSessions: Array.from(new Set([...existing.sourceSessions, ...item.sourceSessions])),
        updatedAt: now,
      }
      byId.set(existing.id, merged)
    } else {
      byId.set(item.id, item)
    }
  }

  const disableIds = new Set(delta.disableItemIds ?? [])
  for (const id of disableIds) {
    const existing = byId.get(id)
    if (existing) {
      byId.set(id, {
        ...existing,
        disabled: true,
        updatedAt: now,
      })
    }
  }

  const all = Array.from(byId.values())
  return all.map((item) => enrichTagsForGlobalMemoryItem(item))
}

export async function updateFromSessions(digests: SessionDigest[]): Promise<void> {
  if (!digests.length) {
    return
  }

  const [aiState, currentProfile, currentItems] = await Promise.all([
    loadAiSettingsState(),
    Promise.resolve(loadUserProfile()),
    Promise.resolve(loadGlobalMemoryItems()),
  ])

  const provider = pickDefaultProviderForGlobalMemory(aiState)
  if (!provider) {
    return
  }

  const systemPrompt = buildSystemPromptForGlobalMemory()
  const defaultModelId = provider.defaultModelId ?? provider.models[0]?.id ?? ''

  if (!defaultModelId) {
    console.warn('[GlobalMemoryService] provider has no model id, skip update')
    return
  }

  const client = createStreamingClientFromSettings(provider, systemPrompt, defaultModelId)

  const messages: ChatMessage[] = [
    {
      role: 'user',
      content: buildUserPromptContent({ digests, currentProfile, currentItems }),
    },
  ]

  let fullContent = ''

  try {
    const result = await client.askStream(
      {
        messages,
        temperature: 0,
        // 这里不强依赖模型的 maxTokens，给一个相对保守的上限
        maxTokens: 1024,
      },
      {
        onChunk: (chunk) => {
          if (chunk.content) {
            fullContent += chunk.content
          }
        },
        onComplete: () => {
          // no-op
        },
        onError: (err) => {
          console.error('[GlobalMemoryService] streaming error', err)
        },
      },
    )

    const raw = (fullContent || result.content || '').trim()
    if (!raw) {
      console.warn('[GlobalMemoryService] empty delta from model, skip apply')
      return
    }

    let parsed: GlobalMemoryDelta | null = null
    try {
      parsed = JSON.parse(raw) as GlobalMemoryDelta
    } catch (e) {
      console.error('[GlobalMemoryService] failed to parse delta JSON', e, raw)
      return
    }

    const nextProfile = applyDeltaToProfile(currentProfile, parsed)
    const nextItems = applyDeltaToItems(currentItems, parsed)

    saveUserProfile(nextProfile)
    saveGlobalMemoryItems(nextItems)
  } catch (e) {
    console.error('[GlobalMemoryService] updateFromSessions failed', e)
  }
}
