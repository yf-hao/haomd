import type { GlobalMemoryItem } from './types'
import { loadGlobalMemoryItems } from './repo'
import { loadGlobalMemorySettings } from './settingsRepo'
import type { ChatEntryMode } from '../domain/chatSession'

export type TaskType =
  | 'chat'
  | 'file'
  | 'selection'
  | 'summarize'
  | 'code'
  | 'paper'
  | 'design'
  | 'command'

export type RequestSource = 'chat-pane' | 'command' | 'other'

export type RequestContext = {
  source: RequestSource
  entryMode?: ChatEntryMode
  sourceCommand?: string
  userInput: string
  docPath?: string | null
}

export type CurrentContext = {
  docPath: string | null
  taskType: TaskType
  language: string
  recentInstructions: string[]
}

export function inferTaskType(req: RequestContext): TaskType {
  if (req.entryMode === 'file') return 'file'
  if (req.entryMode === 'selection') return 'selection'

  if (req.sourceCommand === 'ai_ask_file') return 'file'
  if (req.sourceCommand === 'ai_ask_selection') return 'selection'

  const text = req.userInput.toLowerCase()
  if (text.includes('论文') || text.includes('paper')) return 'paper'
  if (text.includes('代码') || text.includes('bug') || text.includes('typescript')) return 'code'

  return 'chat'
}

export function inferScenarioTags(taskType: TaskType): string[] {
  switch (taskType) {
    case 'file':
    case 'summarize':
      return ['file', 'summarize']
    case 'selection':
      return ['selection', 'rewrite']
    case 'code':
      return ['code']
    case 'paper':
      return ['paper', 'format']
    case 'design':
      return ['design']
    default:
      return ['language', 'style']
  }
}

function detectLanguageOrUseSetting(text: string): string {
  const asciiLetters = (text.match(/[a-zA-Z]/g) ?? []).length
  const cjkChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length

  if (asciiLetters === 0 && cjkChars === 0) {
    return 'zh-CN'
  }

  if (cjkChars >= asciiLetters) {
    return 'zh-CN'
  }

  return 'en'
}

export function buildCurrentContext(req: RequestContext): CurrentContext {
  const taskType = inferTaskType(req)
  const language = detectLanguageOrUseSetting(req.userInput)

  return {
    docPath: req.docPath ?? null,
    taskType,
    language,
    recentInstructions: [req.userInput].filter((s) => s.trim().length > 0),
  }
}

function scoreMemoryItem(item: GlobalMemoryItem, scenarioTags: string[]): number {
  if (item.disabled) return -Infinity

  let score = 0

  if (Array.isArray(item.tags) && item.tags.length > 0) {
    const hitCount = item.tags.filter((t) => scenarioTags.includes(t)).length
    if (hitCount > 0) {
      score += hitCount * 2
    }
  }

  if (typeof item.weight === 'number') {
    score += item.weight * 3
  }

  const docCount = item.sourceDocs?.length ?? 0
  if (docCount > 0) {
    score += Math.log(1 + docCount)
  }

  if (item.pinned) {
    score += 5
  }

  const ageMs = Date.now() - (item.updatedAt ?? item.createdAt)
  const ageDays = ageMs / (1000 * 60 * 60 * 24)
  if (ageDays < 1) {
    score += 1.5
  } else if (ageDays < 7) {
    score += 1
  }

  return score
}

export function selectMemoriesForContext(context: CurrentContext, maxItems = 5): GlobalMemoryItem[] {
  const settings = loadGlobalMemorySettings()
  if (!settings.enabled) {
    return []
  }

  const items = loadGlobalMemoryItems()
  if (!items.length) return []

  const scenarioTags = inferScenarioTags(context.taskType)

  const scored = items
    .filter((item) => !item.disabled)
    .map((item) => ({ item, score: scoreMemoryItem(item, scenarioTags) }))
    .filter(({ score }) => Number.isFinite(score) && score > 0)

  if (!scored.length) return []

  scored.sort((a, b) => b.score - a.score)

  return scored.slice(0, maxItems).map((entry) => entry.item)
}

export function buildGlobalMemorySystemPrompt(baseSystemPrompt: string | undefined, req: RequestContext): string {
  const base = (baseSystemPrompt ?? '').trim()
  const context = buildCurrentContext(req)
  const selected = selectMemoriesForContext(context)

  if (!selected.length) return base

  const lines: string[] = []
  lines.push('User preferences (from global memory):')
  for (const mem of selected) {
    lines.push(`- ${mem.content}`)
  }

  const snippet = lines.join('\n')

  if (!base) {
    return snippet
  }

  return `${base}\n\n${snippet}`
}
