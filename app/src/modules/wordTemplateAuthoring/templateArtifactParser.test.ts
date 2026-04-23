import { describe, expect, it } from 'vitest'
import {
  parseWordTemplateArtifact,
  tryParseWordTemplateArtifact,
} from './templateArtifactParser'

const RAW_ARTIFACT = JSON.stringify({
  templateId: 'meeting-notes',
  templateName: '会议纪要模板',
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
    ],
  },
  usageMarkdown: '# 使用说明\n\n请在 front matter 中填写 title。\n正文使用标题组织章节。',
  sampleMarkdown: '---\ntitle: 周会\n---\n\n# 决议\n\n内容',
})

describe('templateArtifactParser', () => {
  it('should parse a valid template artifact', () => {
    const parsed = parseWordTemplateArtifact(RAW_ARTIFACT)

    expect(parsed.templateId).toBe('meeting-notes')
    expect(parsed.templateJson.bindings[0]?.field).toBe('meta.title')
    expect(parsed.usageMarkdown).toContain('front matter')
  })

  it('should report invalid JSON via tryParseWordTemplateArtifact', () => {
    const result = tryParseWordTemplateArtifact('{invalid json')

    expect(result.draft).toBeNull()
    expect(result.errors[0]?.code).toBe('invalid_artifact')
  })

  it('should report missing top-level fields', () => {
    const result = tryParseWordTemplateArtifact(
      JSON.stringify({
        templateId: 'meeting-notes',
        templateJson: {},
      }),
    )

    expect(result.draft).toBeNull()
    expect(result.errors[0]?.code).toBe('invalid_artifact')
  })
})
