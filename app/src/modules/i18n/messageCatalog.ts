import { enUSMessages } from './messages/en-US'
import { zhCNMessages } from './messages/zh-CN'
import type { MessageDictionary, MessageParams, ResolvedLanguage } from './schema'

const messageCatalog: Record<ResolvedLanguage, MessageDictionary> = {
  'zh-CN': zhCNMessages,
  'en-US': enUSMessages,
}

function getNestedMessage(source: MessageDictionary, key: string): string | null {
  const parts = key.split('.')
  let current: unknown = source
  for (const part of parts) {
    if (!current || typeof current !== 'object' || !(part in current)) {
      return null
    }
    current = (current as MessageDictionary)[part]
  }
  return typeof current === 'string' ? current : null
}

function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key]
    return value == null ? `{${key}}` : String(value)
  })
}

export function translateMessage(
  language: ResolvedLanguage,
  key: string,
  params?: MessageParams,
): string {
  const primary = getNestedMessage(messageCatalog[language], key)
  if (primary) return interpolate(primary, params)
  const fallback = getNestedMessage(enUSMessages, key)
  if (fallback) return interpolate(fallback, params)
  return key
}
