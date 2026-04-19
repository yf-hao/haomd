import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runWorkflow } from './workflowRuntimeService'
import type { WorkflowDocument } from '../domain/types'

function createWorkflow(overrides: Partial<WorkflowDocument> = {}): WorkflowDocument {
  return {
    id: 'contact-normalize',
    name: 'Contact Normalize',
    description: '提取并格式化联系人信息',
    enabled: true,
    approvalPolicy: 'ask',
    failurePolicy: 'fail_fast',
    inputSchema: JSON.stringify({
      type: 'object',
      properties: {
        text: { type: 'string' },
      },
      required: ['text'],
    }),
    outputFrom: 'steps.wrap.stdout',
    markdown: '# Contact Normalize',
    steps: [
      {
        id: 'extract',
        type: 'skill',
        skillId: 'extract-contact-skill',
        scriptId: 'run',
        inputTemplate: JSON.stringify({
          text: '{{input.text}}',
        }),
      },
      {
        id: 'wrap',
        type: 'skill',
        skillId: 'wrap-text-skill',
        scriptId: 'run',
        inputTemplate: JSON.stringify({
          text: '{{steps.extract.json.name}}',
          prefix: '联系人：',
          suffix: '',
        }),
      },
    ],
    ...overrides,
  }
}

describe('workflowRuntimeService', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('should execute workflow steps sequentially with template mapping', async () => {
    const calls: unknown[][] = []
    const runSkillScriptSpy = async (...args: unknown[]) => {
      calls.push(args)
      if (calls.length === 1) {
        return {
          ok: true,
          stdout: '{"name":"张三","email":"zhangsan@example.com"}',
          stderr: '',
          exitCode: 0,
        }
      }
      return {
        ok: true,
        stdout: '联系人：张三',
        stderr: '',
        exitCode: 0,
      }
    }

    const result = await runWorkflow(createWorkflow(), {
      text: '张三，邮箱 zhangsan@example.com',
    }, runSkillScriptSpy)

    expect(calls[0]).toEqual(['extract-contact-skill', 'run', {
      text: '张三，邮箱 zhangsan@example.com',
    }])
    expect(calls[1]).toEqual(['wrap-text-skill', 'run', {
      text: '张三',
      prefix: '联系人：',
      suffix: '',
    }])
    expect(result).toMatchObject({
      ok: true,
      output: '联系人：张三',
    })
  })

  it('should stop on first failure when failurePolicy is fail_fast', async () => {
    const calls: unknown[][] = []
    const runSkillScriptSpy = async (...args: unknown[]) => {
      calls.push(args)
      return {
        ok: false,
        stdout: '',
        stderr: 'step failed',
        exitCode: 1,
      }
    }

    const result = await runWorkflow(createWorkflow(), {
      text: '张三，邮箱 zhangsan@example.com',
    }, runSkillScriptSpy)

    expect(calls).toHaveLength(1)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('step failed')
  })
})
