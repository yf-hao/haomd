import { describe, expect, it } from 'vitest'
import { resolveWorkflowReference, resolveWorkflowTemplateValue } from './workflowTemplateResolver'
import type { WorkflowStepRunResult } from '../domain/types'

function createStep(overrides: Partial<WorkflowStepRunResult> = {}): WorkflowStepRunResult {
  return {
    stepId: 'extract',
    skillId: 'extract-contact-skill',
    scriptId: 'run',
    resolvedInput: { text: 'raw' },
    ok: true,
    stdout: '{"name":"张三","email":"zhangsan@example.com"}',
    stderr: '',
    exitCode: 0,
    json: { name: '张三', email: 'zhangsan@example.com' },
    ...overrides,
  }
}

describe('workflowTemplateResolver', () => {
  it('should resolve input and step json references', () => {
    const context = {
      input: { text: '张三，邮箱 zhangsan@example.com' },
      steps: { extract: createStep() },
    }

    expect(resolveWorkflowReference('input.text', context)).toBe('张三，邮箱 zhangsan@example.com')
    expect(resolveWorkflowReference('steps.extract.stdout', context)).toBe('{"name":"张三","email":"zhangsan@example.com"}')
    expect(resolveWorkflowReference('steps.extract.json.name', context)).toBe('张三')
  })

  it('should preserve non-string values for exact template matches', () => {
    const context = {
      input: { text: 'raw' },
      steps: { extract: createStep() },
    }

    expect(resolveWorkflowTemplateValue('{{steps.extract.json}}', context)).toEqual({
      name: '张三',
      email: 'zhangsan@example.com',
    })
    expect(
      resolveWorkflowTemplateValue(
        {
          text: '{{steps.extract.json.name}}',
          prefix: '联系人信息：',
          meta: '{{steps.extract.json}}',
        },
        context,
      ),
    ).toEqual({
      text: '张三',
      prefix: '联系人信息：',
      meta: {
        name: '张三',
        email: 'zhangsan@example.com',
      },
    })
  })
})
