import { describe, expect, it } from 'vitest'
import type {
  IStreamingChatClient,
  StreamingChatRequest,
  StreamingChatResult,
} from '../ai/domain/types'
import {
  acceptWordTemplateBuild,
  cancelWordTemplateBuild,
  continueWordTemplateBuildRefinement,
  startCreateWordTemplateBuild,
  startReviseWordTemplateBuild,
} from './templateAuthoringService'
import type { WordTemplateDraft } from './types'

const validDraft: WordTemplateDraft = {
  templateId: 'meeting-notes',
  templateName: '会议纪要模板',
  templateRequest: '生成一个会议纪要模板',
  templateJson: {
    templateId: 'meeting-notes',
    name: '会议纪要模板',
    bindings: [
      {
        field: 'meta.title',
        placeholder: '{{title}}',
        type: 'text',
        source: {
          kind: 'frontMatter',
          key: 'title',
        },
      },
      {
        field: 'sections.decisions',
        placeholder: '{{decisions}}',
        type: 'richText',
        richTextStyleSource: 'normal',
        source: {
          kind: 'heading',
          match: '决议',
        },
      },
    ],
  },
  usageMarkdown:
    '# 使用说明\n\n' +
    '- 在 `template.docx` 中按原样放置 `{{title}}` 和 `{{decisions}}` 占位符\n' +
    '- 占位符支持 `{{key}}` 和 `${key}`；key 前后的多个空格会被忽略\n' +
    '- placeholder key 使用英文 ASCII 标识符\n' +
    '- `text` 占位符可放在段落文字中；`richText` 占位符必须独占一个段落\n' +
    '- front matter 中填写 `title`\n' +
    '- front matter 键名使用英文 ASCII 标识符，允许下划线；值可以是中文\n' +
    '- 使用 `# 决议` 标题组织正文\n' +
    '- `meta.title` 对应 front matter 的 `title`\n' +
    '- `sections.decisions` 对应标题为 `决议` 的章节\n' +
    '- `sections.decisions` 使用 Normal 样式作为富文本格式来源\n',
  sampleMarkdown:
    '---\n' +
    'title: 周会纪要\n' +
    '---\n\n' +
    '# 决议\n\n' +
    '本周结论。\n',
}

function createMockClient(output: string): IStreamingChatClient {
  return {
    askStream: async (_request: StreamingChatRequest, handlers): Promise<StreamingChatResult> => {
      handlers.onChunk?.({ content: output })
      handlers.onComplete?.(output, output.length)
      return {
        content: output,
        tokenCount: output.length,
        completed: true,
      }
    },
  }
}

describe('templateAuthoringService', () => {
  it('should start a create build and return a validated session', async () => {
    const session = await startCreateWordTemplateBuild('生成一个会议纪要模板', {
      client: createMockClient(JSON.stringify(validDraft)),
    })

    expect(session.status).toBe('validated')
    expect(session.currentDraft?.templateId).toBe('meeting-notes')
  })

  it('should start a revise build from an existing draft', async () => {
    const session = await startReviseWordTemplateBuild(validDraft, '把标题改成会议主题', {
      client: createMockClient(JSON.stringify(validDraft)),
    })

    expect(session.status).toBe('validated')
    expect(session.baseTemplateId).toBe('meeting-notes')
  })

  it('should continue refinement from an existing validated session', async () => {
    const baseSession = await startCreateWordTemplateBuild('生成一个会议纪要模板', {
      client: createMockClient(JSON.stringify(validDraft)),
    })

    const next = await continueWordTemplateBuildRefinement(
      baseSession,
      '增加风险章节',
      {
        client: createMockClient(JSON.stringify(validDraft)),
      },
    )

    expect(next.status).toBe('validated')
    expect(next.userRequest).toBe('增加风险章节')
  })

  it('should re-export accept and cancel helpers', async () => {
    const baseSession = await startCreateWordTemplateBuild('生成一个会议纪要模板', {
      client: createMockClient(JSON.stringify(validDraft)),
    })

    const accepted = await acceptWordTemplateBuild(baseSession, async () => {})
    const cancelled = cancelWordTemplateBuild(baseSession)

    expect(accepted.status).toBe('accepted')
    expect(cancelled.status).toBe('cancelled')
  })
})
