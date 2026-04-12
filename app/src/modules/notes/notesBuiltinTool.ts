import type { OpenAIToolDef } from '../ai/domain/types'
import { getNotesConfig } from '../settings/editorSettings'
import { createNote } from './notesFileService'

export const WRITE_TO_NOTES_TOOL_NAME = 'write_to_notes'

/**
 * OpenAI Function Calling schema for write_to_notes.
 * Injected into every OpenAI-compatible request so the model can call it
 * whenever the user expresses intent to save content to notes.
 */
export const writeToNotesToolSchema: OpenAIToolDef = {
  type: 'function',
  function: {
    name: WRITE_TO_NOTES_TOOL_NAME,
    description:
      '将内容保存为随笔/笔记文件。' +
      '当用户要求将内容写入随笔、保存到笔记、记录到笔记中，或只说“保存起来”但没有指定工作区目录时，调用此工具。' +
      '如果用户没有明确指定当前文件浏览器中的课程目录、子目录、工作区目录，则默认使用此工具。' +
      '会在用户配置的随笔目录中自动创建以标题命名的 Markdown 文件。' +
      '如果用户要求先总结再保存，请先生成摘要，再将摘要内容和合适的标题传入此工具。',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '要保存的 Markdown 格式内容（可包含标题、正文、代码块等）',
        },
        title: {
          type: 'string',
          description: '随笔标题，用于文件命名（如"我的随笔"），省略时自动从内容首行提取',
        },
      },
      required: ['content'],
    },
  },
}

/** 从内容首行提取标题（支持 # 标题 格式，或直接取首行文字） */
function extractTitleFromContent(content: string): string | undefined {
  const firstLine = content.trimStart().split('\n')[0].trim()
  const headingMatch = firstLine.match(/^#+\s+(.+)/)
  if (headingMatch) return headingMatch[1].trim()
  // 首行有文字且不超过 40 字符时作为标题
  if (firstLine && firstLine.length <= 40) return firstLine
  return undefined
}

/**
 * Execute the write_to_notes built-in tool.
 * Reads the notes directory from settings dynamically so config changes take effect immediately.
 */
export async function executeWriteToNotes(args: { content?: string; title?: string }): Promise<string> {
  const content = args.content ?? ''
  if (!content.trim()) {
    return '⚠️ 内容为空，未保存随笔。'
  }

  const cfg = await getNotesConfig()
  if (!cfg.notesDirectory) {
    return '⚠️ 尚未配置随笔保存目录。请先在左侧随笔侧边栏中点击 📁 图标选择目录，然后重试。'
  }

  // 优先使用模型提供的标题，其次从内容提取，最后时间戳兜底（createNote 内处理）
  const title = args.title?.trim() || extractTitleFromContent(content)

  try {
    const filePath = await createNote(cfg.notesDirectory, content, title)
    return `✅ 随笔已保存：${filePath}`
  } catch (e) {
    return `❌ 保存失败：${String(e)}`
  }
}
