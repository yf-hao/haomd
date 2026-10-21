import { describe, expect, it } from 'vitest'
import { findInlineFieldValue, parseMarkdownToTemplateModel } from './parseMarkdownToTemplateModel'

describe('export/word - template markdown parsing', () => {
  it('should map inline field markers with either colon and trim label and value', () => {
    const markdown = [
      '# 项目信息',
      '',
      '{{ 作者 ： 张三 }}',
      '{{日期: 2026：10 }}',
      '{{未完成标记}}',
    ].join('\n')

    const parsed = parseMarkdownToTemplateModel(markdown, {
      templateId: 'project-application',
      bindings: [
        {
          field: 'meta.author',
          placeholder: '{{author}}',
          type: 'text',
          source: { kind: 'inline', label: '作者' },
        },
        {
          field: 'meta.period',
          placeholder: '{{period}}',
          type: 'text',
          source: { kind: 'inline', label: '日期' },
        },
      ],
    })

    expect(parsed.model.meta).toEqual({ author: '张三', period: '2026：10' })
    expect(findInlineFieldValue(markdown, '未完成标记')).toBeNull()
  })

  it('should read marked Markdown table columns as one-based data rows', () => {
    const markdown = [
      '# 进度安排',
      '',
      '| {{序号}} | {{起止日期}} | {{任务}} |',
      '| --- | --- | --- |',
      '| 1 | 2025年10月13日-2025年11月09日 | 资料搜集、文献整理 |',
      '| 2 | 2025年11月10日-2025年12月21日 | 完成需求分析 |',
    ].join('\n')

    const parsed = parseMarkdownToTemplateModel(markdown, {
      templateId: 'project-application',
      bindings: [
        {
          field: 'tables.number',
          placeholder: '{{rowCode}}',
          type: 'text',
          source: { kind: 'table', header: '{{序号}}' },
        },
        {
          field: 'tables.deadline',
          placeholder: '{{dateRange}}',
          type: 'text',
          source: { kind: 'table', header: '{{起止日期}}' },
        },
        {
          field: 'tables.task',
          placeholder: '{{workItem}}',
          type: 'text',
          source: { kind: 'table', header: '{{任务}}' },
        },
      ],
    })

    expect(parsed.model.tables).toEqual({
      number: ['1', '2'],
      deadline: ['2025年10月13日-2025年11月09日', '2025年11月10日-2025年12月21日'],
      task: ['资料搜集、文献整理', '完成需求分析'],
    })
  })

  it('should not turn indentation inside a fenced code block into content spaces', () => {
    const markdown = [
      '# 讨论练习作业',
      '',
      '5. 程序入口分析练习',
      '   修改下面程序。',
      '',
      '   ```java',
      '   public class TestNoStatic {',
      '       public void main(String[] args) {',
      '           System.out.println("Hello");',
      '       }',
      '   }',
      '   ```',
      '',
      '6. 注释规范练习',
    ].join('\n')

    const parsed = parseMarkdownToTemplateModel(markdown, {
      templateId: 'teaching_plan',
      bindings: [{
        field: 'sections.discussion',
        placeholder: '${discussion}',
        type: 'richText',
        source: { kind: 'heading', match: '讨论练习作业' },
      }],
    })

    const blocks = parsed.richBlocksByField['sections.discussion'] ?? []
    const code = blocks.find((block) => block.type === 'code')

    expect(code).toEqual(expect.objectContaining({
      type: 'code',
      language: 'java',
      content: [
        'public class TestNoStatic {',
        '    public void main(String[] args) {',
        '        System.out.println("Hello");',
        '    }',
        '}',
      ].join('\n'),
    }))
  })
})
