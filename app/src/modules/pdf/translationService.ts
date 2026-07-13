import { createStreamingClientFromSettings } from '../ai/streamingClientFactory'
import { loadAiSettingsState } from '../ai/settings'
import type { ChatMessage } from '../ai/domain/types'

export type PdfTranslationEntry = {
  sourceText: string
  translation: string
  partOfSpeech: string | null
  phonetic: string | null
  definition: string | null
  example: string | null
  mode: 'dictionary' | 'translation'
}

const PDF_TRANSLATION_SYSTEM_PROMPT = `你是专业的 PDF 文本翻译助手。

你必须只输出一个严格的 JSON 对象，不要输出 Markdown、代码块、解释文字或前后缀。

JSON 结构如下：
{
  "mode": "dictionary" | "translation",
  "sourceText": string,
  "translation": string,
  "partOfSpeech": string | null,
  "phonetic": string | null,
  "definition": string | null,
  "example": string | null
}

规则：
1. 如果输入是单词、短语或适合查词典的短文本，mode 使用 "dictionary"。
2. 如果输入是句子或段落，mode 使用 "translation"。
3. dictionary 模式下：
   - translation 填写中文释义，可按常见义项合并，用中文分号分隔。
   - partOfSpeech 填写英文词性，如 noun / verb / adjective / adverb / phrase。
   - phonetic 填写 IPA 音标，若能确定，使用 /.../ 的形式。
   - definition 填写简洁英文解释。
   - example 填写一个自然英文例句。
4. translation 模式下：
   - translation 填写自然中文译文。
   - partOfSpeech、phonetic、definition、example 若不适用则填 null。
5. sourceText 必须原样回填用户输入的文本。
6. 除 JSON 之外不要输出任何内容。`

export type TranslatePdfSelectionOptions = {
  text: string
  sourceLanguage?: string
  targetLanguage?: string
  signal?: AbortSignal
  onDelta?: (text: string) => void
}

function isDictionaryLikeSelection(text: string) {
  const compact = text.trim()
  if (!compact) return false
  if (/[\n。！？!?]/.test(compact)) return false
  if (compact.length > 96) return false
  return compact.split(/\s+/).length <= 6
}

function stripJsonFences(raw: string) {
  const trimmed = raw.trim()
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
  const start = withoutFence.indexOf('{')
  const end = withoutFence.lastIndexOf('}')
  if (start >= 0 && end > start) {
    return withoutFence.slice(start, end + 1)
  }
  return withoutFence
}

function normalizePdfTranslationEntry(raw: string, sourceText: string): PdfTranslationEntry {
  const fallbackMode = isDictionaryLikeSelection(sourceText) ? 'dictionary' : 'translation'
  try {
    const parsed = JSON.parse(stripJsonFences(raw)) as Partial<PdfTranslationEntry> & { mode?: unknown }
    const mode = parsed.mode === 'dictionary' ? 'dictionary' : parsed.mode === 'translation' ? 'translation' : fallbackMode
    const translation = typeof parsed.translation === 'string' && parsed.translation.trim()
      ? parsed.translation.trim()
      : raw.trim()
    return {
      sourceText: typeof parsed.sourceText === 'string' && parsed.sourceText.trim() ? parsed.sourceText.trim() : sourceText,
      translation,
      partOfSpeech: typeof parsed.partOfSpeech === 'string' && parsed.partOfSpeech.trim() ? parsed.partOfSpeech.trim() : null,
      phonetic: typeof parsed.phonetic === 'string' && parsed.phonetic.trim() ? parsed.phonetic.trim() : null,
      definition: typeof parsed.definition === 'string' && parsed.definition.trim() ? parsed.definition.trim() : null,
      example: typeof parsed.example === 'string' && parsed.example.trim() ? parsed.example.trim() : null,
      mode,
    }
  } catch {
    return {
      sourceText,
      translation: raw.trim() || sourceText,
      partOfSpeech: null,
      phonetic: null,
      definition: null,
      example: null,
      mode: fallbackMode,
    }
  }
}

export async function translatePdfSelection({
  text,
  sourceLanguage = '英语',
  targetLanguage = '简体中文',
  signal,
  onDelta,
}: TranslatePdfSelectionOptions): Promise<PdfTranslationEntry> {
  const source = text.trim()
  if (!source) throw new Error('没有可翻译的文本')

  const settings = await loadAiSettingsState()
  const provider = settings.providers.find((item) => item.id === settings.defaultProviderId) ?? settings.providers[0]
  if (!provider) throw new Error('请先在 AI 设置中配置默认 Provider 和模型')

  const modelId = provider.defaultModelId ?? provider.models[0]?.id
  if (!modelId) throw new Error('默认 Provider 未配置可用模型')

  const translationInstruction = sourceLanguage === '自动检测'
    ? `自动检测源语言并翻译为${targetLanguage}`
    : `从${sourceLanguage}翻译为${targetLanguage}`
  const selectionMode = isDictionaryLikeSelection(source) ? 'dictionary' : 'translation'
  const systemPrompt = `${PDF_TRANSLATION_SYSTEM_PROMPT}\n\n当前任务：${translationInstruction}。\n当前文本模式：${selectionMode === 'dictionary' ? '词条详细解释' : '句段翻译'}。`
  const client = createStreamingClientFromSettings(provider, systemPrompt, modelId)
  const messages: ChatMessage[] = [{
    role: 'user',
    content: `请根据当前模式处理以下 PDF 选中文本：\n\n<source_text>\n${source}\n</source_text>`,
  }]
  let translated = ''
  const result = await client.askStream(
    {
      messages,
      temperature: 0,
      maxTokens: 2048,
      signal,
    },
    {
      onChunk(chunk) {
        if (!chunk.content) return
        translated += chunk.content
        onDelta?.(translated)
      },
    },
  )

  if (signal?.aborted) throw new DOMException('翻译已取消', 'AbortError')
  if (result.error) throw result.error
  const output = (translated || result.content || '').trim()
  if (!output) throw new Error('翻译服务未返回内容')
  return normalizePdfTranslationEntry(output, source)
}
