import type { DictionaryPronunciationAccent } from '../dictionary/lookup'
import { lookupDictionaryEntry } from '../dictionary/lookup'
import type { PdfTranslationEntry } from './translationService'

export type { DictionaryPronunciationAccent } from '../dictionary/lookup'

export async function lookupTraditionalPdfSelection(
  mdxPath: string,
  text: string,
  accent: DictionaryPronunciationAccent,
): Promise<PdfTranslationEntry | null> {
  const entry = await lookupDictionaryEntry(mdxPath, text, accent)
  if (!entry) return null

  return {
    sourceText: entry.headword,
    translation: entry.translation,
    partOfSpeech: entry.partOfSpeech || null,
    phonetic: entry.phonetic || null,
    definition: entry.definition || null,
    example: entry.example || null,
    pronunciationAudioUrl: entry.pronunciationAudioUrl,
    mode: 'dictionary',
  }
}
