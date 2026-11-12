import { invoke } from '@tauri-apps/api/core'

export type DictionaryInfo = {
  path: string
  title: string
  entries: number
}

export type DictionaryRecord = {
  key: string
  html: string
}

export function openDictionary(mdxPath: string): Promise<DictionaryInfo> {
  return invoke('open_dictionary', { mdxPath })
}

export function lookupDictionary(mdxPath: string, word: string): Promise<DictionaryRecord | null> {
  return invoke('lookup_dictionary', { mdxPath, word })
}

export function readDictionaryAudio(mdxPath: string, resourceKey: string): Promise<string | null> {
  return invoke('read_dictionary_audio', { mdxPath, resourceKey })
}
