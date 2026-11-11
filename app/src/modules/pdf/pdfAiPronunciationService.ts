import { invoke } from '@tauri-apps/api/core'
import { loadAiSettingsState } from '../ai/settings'

const AUDIO_CACHE_SIZE = 32
const audioCache = new Map<string, string>()

export async function synthesizeAiPdfPronunciation(text: string): Promise<string> {
  const settings = await loadAiSettingsState()
  const defaultProvider = settings.providers.find((item) => item.id === settings.defaultProviderId)
  const provider = (defaultProvider?.providerType ?? 'dify') === 'openai'
    ? defaultProvider
    : settings.providers.find((item) => item.providerType === 'openai')
  if (!provider) throw new Error('AI 发音需要一个 OpenAI 兼容 Provider，请先在 AI 设置中添加')

  const normalizedText = text.trim()
  const cacheKey = `${provider.id}\u0000${normalizedText}`
  const cached = audioCache.get(cacheKey)
  if (cached) {
    audioCache.delete(cacheKey)
    audioCache.set(cacheKey, cached)
    return cached
  }

  const audioUrl = await invoke<string>('synthesize_pdf_pronunciation', {
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    text: normalizedText,
  })
  audioCache.set(cacheKey, audioUrl)
  if (audioCache.size > AUDIO_CACHE_SIZE) {
    const oldestKey = audioCache.keys().next().value
    if (oldestKey) audioCache.delete(oldestKey)
  }
  return audioUrl
}
