import { createContext, useContext, type ReactNode } from 'react'
import { translateMessage } from './messageCatalog'
import type { LanguageMode, MessageParams, ResolvedLanguage } from './schema'

export type I18nContextValue = {
  languageMode: LanguageMode
  resolvedLanguage: ResolvedLanguage
  t: (key: string, params?: MessageParams) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({
  value,
  children,
}: Readonly<{
  value: Omit<I18nContextValue, 't'>
  children: ReactNode
}>) {
  const contextValue: I18nContextValue = {
    ...value,
    t: (key, params) => translateMessage(value.resolvedLanguage, key, params),
  }

  return <I18nContext.Provider value={contextValue}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('I18n context is not available')
  return value
}
