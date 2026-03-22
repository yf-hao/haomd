export type LanguageMode = 'system' | 'zh-CN' | 'en-US'

export type ResolvedLanguage = 'zh-CN' | 'en-US'

export type MessageParams = Record<string, string | number>

export type MessageValue = string | MessageDictionary

export type MessageDictionary = {
  [key: string]: MessageValue
}
