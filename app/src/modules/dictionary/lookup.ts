import { lookupDictionary, openDictionary, readDictionaryAudio } from '../dictionaryService'

export type DictionaryPronunciationAccent = 'british' | 'american'

export type DictionaryEntry = {
  headword: string
  translation: string
  definition: string
  example: string
  partOfSpeech: string
  phonetic: string
  inflections: string
  senses: DictionarySense[]
  collocations: string[]
  pronunciationResourceKey: string | null
  britishPronunciationResourceKey: string | null
  americanPronunciationResourceKey: string | null
  pronunciationAudioUrl: string | null
}

export type DictionarySense = {
  number: string
  signpost: string
  partOfSpeech: string
  definition: string
  translation: string
  patterns: string[]
  examples: Array<{ english: string; chinese: string }>
  synonyms: string[]
}

function cleanText(value: string | null | undefined) {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function ownElements(root: Element, selector: string, scopeSelector: string) {
  return [...root.querySelectorAll(selector)].filter((element) => element.closest(scopeSelector) === root)
}

function parseDictionaryHtml(html: string, accent: DictionaryPronunciationAccent) {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const entry = document.querySelector('.entry')
  if (!entry) return null

  const senses = ownElements(entry, '.sense', '.entry')
  const parsedSenses: DictionarySense[] = senses.map((sense) => {
    const definition = ownElements(sense, '.def', '.sense')[0]
    const examples = ownElements(sense, '.example', '.sense')
      .map((example) => ({
        english: cleanText(example.querySelector('EXAEN')?.textContent
          ?? example.querySelector('.sentence_eng')?.textContent),
        chinese: cleanText(example.querySelector('EXAMPLE')?.textContent
          ?? example.querySelector('.sentence_chi')?.textContent),
      }))
      .filter((example) => example.english || example.chinese)
    const patterns = ownElements(sense, '.propform, .propformprep, .lexunit', '.sense')
      .map((element) => cleanText(element.textContent))
      .filter(Boolean)
    const synonyms = ownElements(sense, '.syn', '.sense')
      .map((element) => cleanText(element.textContent).replace(/^SYN\s*/i, '').trim())
      .filter(Boolean)

    return {
      number: cleanText(sense.querySelector('.sensenum')?.textContent),
      signpost: cleanText(sense.querySelector('.signpost')?.textContent),
      partOfSpeech: cleanText(sense.querySelector('.gram')?.textContent
        ?? sense.querySelector('.geo')?.textContent),
      definition: cleanText(definition?.querySelector('EN')?.textContent),
      translation: cleanText(definition?.querySelector('TRAN')?.textContent),
      patterns: [...new Set(patterns)],
      examples,
      synonyms: [...new Set(synonyms)],
    }
  })
  const translations = senses
    .map((sense) => cleanText(sense.querySelector('TRAN')?.textContent))
    .filter(Boolean)
  const definitions = parsedSenses
    .map((sense) => sense.definition)
    .filter(Boolean)
  const examples = parsedSenses.flatMap((sense) => sense.examples.map((example) => example.english)).filter(Boolean)
  const partOfSpeech = [...new Set(ownElements(entry, '.entryhead .pos', '.entry')
    .filter((element) => element.closest('.entry') === entry)
    .map((element) => cleanText(element.textContent))
    .filter(Boolean))]
    .join(', ')
  const phonetic = cleanText(entry.querySelector('.proncodes')?.textContent)
  const inflections = cleanText(ownElements(entry, '.entryhead .inflections', '.entry')[0]?.textContent)
  const collocations = [...new Set(ownElements(entry, '.collobox .collocate', '.entry')
    .map((element) => cleanText(element.textContent))
    .filter(Boolean))]
  const audioLinks = [...entry.querySelectorAll('.entryhead a[href^="sound://"]')]
    .filter((link) => link.closest('.entry') === entry)
  const anyAudio = audioLinks.find((link) => /\.(mp3|wav|spx|ogg)(?:$|\?)/i.test(link.getAttribute('href') ?? ''))
  const britishAudio = audioLinks.find((link) => (link.getAttribute('href') ?? '').includes('/bre/'))
  const americanAudio = audioLinks.find((link) => (link.getAttribute('href') ?? '').includes('/ame/'))
  const preferredAudio = accent === 'british' ? britishAudio : americanAudio
  const preferredAudioKey = preferredAudio?.getAttribute('href')
    ?? anyAudio?.getAttribute('href')
    ?? null

  return {
    translation: translations.join('；'),
    definition: definitions.join(' / '),
    example: examples[0] ?? '',
    partOfSpeech,
    phonetic,
    inflections,
    senses: parsedSenses,
    collocations,
    audioResourceKey: preferredAudioKey,
    britishAudioResourceKey: britishAudio?.getAttribute('href') ?? null,
    americanAudioResourceKey: americanAudio?.getAttribute('href') ?? null,
  }
}

export async function lookupDictionaryEntry(
  mdxPath: string,
  query: string,
  accent: DictionaryPronunciationAccent,
  options: { includeAudio?: boolean } = {},
): Promise<DictionaryEntry | null> {
  await openDictionary(mdxPath)
  const record = await lookupDictionary(mdxPath, query.trim())
  if (!record) return null
  const parsed = parseDictionaryHtml(record.html, accent)
  if (!parsed) throw new Error('词典词条格式无法识别')
  const pronunciationAudioUrl = options.includeAudio !== false && parsed.audioResourceKey
    ? await readDictionaryAudio(mdxPath, parsed.audioResourceKey)
    : null

  return {
    headword: record.key,
    translation: parsed.translation,
    definition: parsed.definition,
    example: parsed.example,
    partOfSpeech: parsed.partOfSpeech,
    phonetic: parsed.phonetic,
    inflections: parsed.inflections,
    senses: parsed.senses,
    collocations: parsed.collocations,
    pronunciationResourceKey: parsed.audioResourceKey,
    britishPronunciationResourceKey: parsed.britishAudioResourceKey,
    americanPronunciationResourceKey: parsed.americanAudioResourceKey,
    pronunciationAudioUrl,
  }
}
