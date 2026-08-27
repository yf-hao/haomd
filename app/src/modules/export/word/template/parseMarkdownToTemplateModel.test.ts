import { describe, expect, it } from 'vitest'
import { parseMarkdownToTemplateModel } from './parseMarkdownToTemplateModel'

describe('export/word - template markdown parsing', () => {
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

    expect(code).toEqual({
      type: 'code',
      language: 'java',
      content: [
        'public class TestNoStatic {',
        '    public void main(String[] args) {',
        '        System.out.println("Hello");',
        '    }',
        '}',
      ].join('\n'),
    })
  })
})
