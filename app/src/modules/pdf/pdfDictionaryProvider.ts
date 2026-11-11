import type { PdfTranslationEntry } from './translationService'
import { lookupPdfDictionary, openPdfDictionary, readPdfDictionaryAudio } from './pdfDictionaryService'

export type DictionaryPronunciationAccent = 'british' | 'american'

function cleanText(value: string | null | undefined) {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function parseDictionaryHtml(html: string, accent: DictionaryPronunciationAccent) {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const entry = document.querySelector('.entry')
  if (!entry) return null

  const senses = [...entry.querySelectorAll('.sense')]
    .filter((sense) => sense.closest('.entry') === entry)
  const translations = senses
    .map((sense) => cleanText(sense.querySelector('TRAN')?.textContent))
    .filter(Boolean)
  const definitions = senses
    .map((sense) => cleanText(sense.querySelector('EN')?.textContent))
    .filter(Boolean)
  const examples = senses
    .map((sense) => cleanText(sense.querySelector('.sentence_eng')?.textContent))
    .filter(Boolean)
  const partOfSpeech = [...entry.querySelectorAll('.entryhead .pos')]
    .map((element) => cleanText(element.textContent))
    .filter(Boolean)
    .join(', ')
  const phonetic = cleanText(entry.querySelector('.proncodes')?.textContent)
  const audioLinks = [...entry.querySelectorAll('.entryhead a[href^="sound://"]')]
  const preferredAudio = audioLinks.find((link) => {
    const href = link.getAttribute('href') ?? ''
    return accent === 'british' ? href.includes('/bre/') : href.includes('/ame/')
  })
  const anyAudio = audioLinks.find((link) => /\.(mp3|wav|spx|ogg)(?:$|\?)/i.test(link.getAttribute('href') ?? ''))

  return {
    translation: translations.join('；'),
    definition: definitions.join(' / '),
    example: examples[0] ?? '',
    partOfSpeech,
    phonetic,
    audioResourceKey: preferredAudio?.getAttribute('href') ?? anyAudio?.getAttribute('href') ?? null,
  }
}

export async function lookupTraditionalPdfSelection(
  mdxPath: string,
  text: string,
  accent: DictionaryPronunciationAccent,
): Promise<PdfTranslationEntry | null> {
  await openPdfDictionary(mdxPath)
  const record = await lookupPdfDictionary(mdxPath, text.trim())
  if (!record) return null

  const parsed = parseDictionaryHtml(record.html, accent)
  if (!parsed) throw new Error('词典词条格式无法识别')
  const pronunciationAudioUrl = parsed.audioResourceKey
    ? await readPdfDictionaryAudio(mdxPath, parsed.audioResourceKey)
    : null

  return {
    sourceText: record.key,
    translation: parsed.translation,
    partOfSpeech: parsed.partOfSpeech || null,
    phonetic: parsed.phonetic || null,
    definition: parsed.definition || null,
    example: parsed.example || null,
    pronunciationAudioUrl,
    mode: 'dictionary',
  }
}
