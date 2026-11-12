const QUERY_PATTERN = /^[A-Za-z]+(?:[-'][A-Za-z]+)*(?:\s+[A-Za-z]+(?:[-'][A-Za-z]+)*){0,5}$/

const CANDIDATE_PATTERNS = [
  /^(?:请)?(?:帮我)?(?:翻译成(?:简体)?中文|翻译为中文|翻译(?:一下)?|翻成中文|译成中文)\s*[：:]?\s*(.+)$/i,
  /^(?:请)?(?:帮我)?(?:把|将)\s*(.+?)\s*(?:翻译成|翻译为|翻译)(?:简体中文|中文|汉语)?[。.!?]*$/i,
  /^(.+?)\s*(?:翻译成|翻译为)(?:简体中文|中文|汉语)[。.!?]*$/i,
  /^(.+?)\s*(?:是什么意思|是什么含义|怎么翻译|的中文意思(?:是什么)?|(?:用)?中文怎么说)[？?。.!]*$/i,
  /^(?:please\s+)?translate(?:\s+the\s+(?:word|phrase))?\s*[:：]?\s*(.+?)(?:\s+(?:into|to)\s+(?:simplified\s+)?(?:Chinese|English|Japanese|French|German))?[?.!]*$/i,
  /^what\s+does\s+(.+?)\s+mean[?.!]*$/i,
  /^meaning\s+of\s+(.+?)[?.!]*$/i,
  /^what\s+is\s+(.+?)\s+in\s+Chinese[?.!]*$/i,
]

export function normalizeDictionaryQuery(candidate: string): string | null {
  const query = candidate.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim()
  if (!query || query.length > 80 || !QUERY_PATTERN.test(query)) return null
  return query.replace(/\s+/g, ' ')
}

/** Extract clear, short English word/phrase translation requests. Ambiguous input stays on the normal AI path. */
export function extractDictionaryTranslationQuery(input: string): string | null {
  const message = input.trim()
  if (!message || message.length > 240) return null
  for (const pattern of CANDIDATE_PATTERNS) {
    const match = message.match(pattern)
    if (!match?.[1]) continue
    const query = normalizeDictionaryQuery(match[1])
    if (query) return query
  }
  return null
}

export type TranslationSourceDirective = {
  source: 'dictionary' | 'ai' | 'automatic'
  query: string | null
  explicit: boolean
}

const LOCAL_DICTIONARY_PREFIXES = [
  /^(?:please\s+)?(?:use|using)\s+(?:the\s+)?(?:local\s+)?dictionary(?:\s+to)?\s*(?:translate|look\s+up|explain)?\s*[:：]?\s*(.*)$/i,
  /^(?:please\s+)?local\s+dictionary\s*(?:to\s*)?(?:translate|look\s+up)\s*[:：]?\s*(.*)$/i,
  /^(?:请)?(?:帮我)?(?:使用|用)(?:本地)?(?:词典|字典)(?:(?:帮我)?(?:翻译|查词|查询|查|解释)(?:一下)?)?\s*[：:]?\s*(.*)$/i,
  /^(?:请)?(?:本地)?(?:词典|字典)(?:翻译|查词|查询|查|解释)(?:一下)?\s*[：:]?\s*(.*)$/i,
]

const ENGLISH_LOCAL_SUFFIX = /\s+(?:using|with)\s+(?:the\s+)?(?:local\s+)?dictionary[。.!?]*$/i
const CHINESE_LOCAL_SUFFIX = /(?:，|,|\s)*(?:使用|用)(?:本地)?(?:词典|字典)(?:翻译)?[。.!?]*$/

function extractExplicitDictionaryQuery(value: string): string | null {
  const raw = value.trim().replace(/^[：:]\s*/, '')
  return extractDictionaryTranslationQuery(raw)
    ?? extractDictionaryTranslationQuery(`翻译 ${raw}`)
    ?? normalizeDictionaryQuery(raw)
}

export function detectTranslationSourceDirective(input: string): TranslationSourceDirective {
  const message = input.trim()
  const requestsAi = /^(?:please\s+)?(?:use\s+)?(?:AI|artificial intelligence)(?:\s+model)?\s+(?:to\s+)?translate\b/i.test(message)
    || /^(?:请)?(?:明确)?(?:用|使用)\s*AI(?:模型)?(?:帮我)?翻译/i.test(message)
    || /^(?:请)?(?:让)?AI(?:模型)?(?:帮我)?翻译/i.test(message)
    || /\btranslate\b.*\b(?:with|using)\s+AI\b/i.test(message)
    || /(?:不要|别|不用|不使用)\s*(?:(?:使用|用)\s*)?(?:本地)?(?:词典|字典)/i.test(message)
    || /\b(?:don't|do not)\s+use\s+(?:the\s+)?(?:local\s+)?dictionary\b/i.test(message)
  if (requestsAi) return { source: 'ai', query: null, explicit: true }

  for (const pattern of LOCAL_DICTIONARY_PREFIXES) {
    const match = message.match(pattern)
    if (match) {
      return {
        source: 'dictionary',
        query: extractExplicitDictionaryQuery(match[1] ?? ''),
        explicit: true,
      }
    }
  }

  if (ENGLISH_LOCAL_SUFFIX.test(message)) {
    const request = message.replace(ENGLISH_LOCAL_SUFFIX, '').trim()
    return { source: 'dictionary', query: extractExplicitDictionaryQuery(request), explicit: true }
  }
  if (CHINESE_LOCAL_SUFFIX.test(message)) {
    const request = message.replace(CHINESE_LOCAL_SUFFIX, '').trim()
    return { source: 'dictionary', query: extractExplicitDictionaryQuery(request), explicit: true }
  }

  return { source: 'automatic', query: null, explicit: false }
}
