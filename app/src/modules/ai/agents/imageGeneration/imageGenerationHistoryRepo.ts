import type { ImageGenerationResult } from './types'

const STORAGE_KEY = 'haomd_image_generation_history'
const MAX_ITEMS = 20

export type ImageGenerationHistoryItem = {
  id: string
  agentId: string
  agentName: string
  prompt: string
  imageUrl: string
  taskId: string
  createdAt: number
}

function loadAll(): ImageGenerationHistoryItem[] {
  if (typeof window === 'undefined' || !window.localStorage) return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ImageGenerationHistoryItem[]
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    console.warn('[imageGenerationHistoryRepo] load failed', err)
    return []
  }
}

function saveAll(items: ImageGenerationHistoryItem[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch (err) {
    console.warn('[imageGenerationHistoryRepo] save failed', err)
  }
}

export function listImageGenerationHistory(): ImageGenerationHistoryItem[] {
  return loadAll().sort((a, b) => b.createdAt - a.createdAt)
}

export function appendImageGenerationHistory(params: {
  agentId: string
  agentName: string
  prompt: string
  result: ImageGenerationResult
}): void {
  const items = loadAll()
  const next: ImageGenerationHistoryItem = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    agentId: params.agentId,
    agentName: params.agentName,
    prompt: params.prompt,
    imageUrl: params.result.imageUrl,
    taskId: params.result.taskId,
    createdAt: Date.now(),
  }
  saveAll([next, ...items].slice(0, MAX_ITEMS))
}
