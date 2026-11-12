import type { DictionaryEntry } from './lookup'

export type DictionaryChatTranslator = (key: string, params?: Record<string, string | number>) => string

export function formatDictionaryEntryForChat(
  entry: DictionaryEntry,
  t?: DictionaryChatTranslator,
): string {
  const label = (key: string, fallback: string) => t?.(`dictionarySettings.${key}`) ?? fallback
  const lines: string[] = []
  if (entry.inflections) lines.push(`**${label('inflections', 'Inflections')}** ${entry.inflections}`)
  for (const sense of entry.senses) {
    const heading = [sense.number && `${sense.number}.`, sense.signpost]
      .filter(Boolean)
      .join(' ')
    const parts = [
      heading ? `**${heading}**` : `**${label('sense', 'Sense')}**`,
      sense.partOfSpeech ? `*[${sense.partOfSpeech.replace(/^\[|\]$/g, '')}]*` : '',
      sense.definition,
      sense.translation,
    ].filter(Boolean)
    if (parts.length > 0) lines.push(parts.join(' '))
    if (sense.patterns.length > 0) {
      lines.push(`**${label('patterns', 'Patterns')}** ${sense.patterns.join(' · ')}`)
    }
    for (const example of sense.examples) {
      const exampleText = [example.english && `*${example.english}*`, example.chinese]
        .filter(Boolean)
        .join(' — ')
      lines.push(`> ${exampleText}`)
    }
    if (sense.synonyms.length > 0) {
      lines.push(`**${label('synonyms', 'Synonyms')}** ${sense.synonyms.join(', ')}`)
    }
  }
  if (entry.collocations.length > 0) {
    lines.push(`#### ${label('collocations', 'Collocations')}`)
    lines.push(...entry.collocations.map((collocation) => `- ${collocation}`))
  }
  lines.push(`_${label('dictionarySource', 'Source: local dictionary')}_`)
  return lines.join('\n\n')
}
