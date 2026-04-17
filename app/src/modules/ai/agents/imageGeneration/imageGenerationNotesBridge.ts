import { createNote } from '../../../notes/notesFileService'
import { getNotesConfig } from '../../../settings/editorSettings'
import type { AgentProvider } from '../../domain/types'
import type { ImageGenerationResult } from './types'

export async function saveImageGenerationToNotes(params: {
  agent: AgentProvider
  prompt: string
  result: ImageGenerationResult
}): Promise<string> {
  const notes = await getNotesConfig()
  if (!notes.notesDirectory) {
    throw new Error('尚未配置随笔目录')
  }

  const title = `${params.prompt.trim().slice(0, 30) || '图片生成结果'}`
  const content = [
    `# ${title}`,
    '',
    `- Agent: ${params.agent.name}`,
    `- Model: ${params.agent.modelId ?? '-'}`,
    `- Generated At: ${new Date().toLocaleString()}`,
    `- Task ID: ${params.result.taskId}`,
    '',
    '## Prompt',
    '',
    params.prompt.trim(),
    '',
    '## Image',
    '',
    `![${params.prompt.trim() || 'generated image'}](${params.result.imageUrl})`,
    '',
    '## URL',
    '',
    params.result.imageUrl,
    '',
  ].join('\n')

  return createNote(notes.notesDirectory, content, title)
}
