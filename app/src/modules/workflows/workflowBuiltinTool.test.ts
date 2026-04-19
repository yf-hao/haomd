import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  executeWorkflowRead,
  executeWorkflowRun,
  executeWorkflowSearch,
} from './workflowBuiltinTool'
import * as workflowsRepo from './storage/workflowsRepo'
import * as workflowRuntimeService from './application/workflowRuntimeService'
import type { WorkflowDocument } from './domain/types'

function createWorkflow(overrides: Partial<WorkflowDocument> = {}): WorkflowDocument {
  return {
    id: 'contact-normalize',
    name: 'Contact Normalize',
    description: '提取并规范化联系人信息',
    enabled: true,
    approvalPolicy: 'ask',
    failurePolicy: 'fail_fast',
    inputSchema: '{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}',
    outputFrom: 'steps.wrap.stdout',
    markdown: '# Contact Normalize',
    steps: [
      {
        id: 'extract',
        type: 'skill',
        skillId: 'extract-contact-skill',
        scriptId: 'run',
        inputTemplate: '{"text":"{{input.text}}"}',
      },
    ],
    ...overrides,
  }
}

describe('workflowBuiltinTool', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('executeWorkflowSearch should return enabled workflows only', async () => {
    vi.spyOn(workflowsRepo, 'listWorkflows').mockResolvedValue([
      { id: 'contact-normalize', name: 'Contact Normalize', description: '提取并规范化联系人信息', enabled: true, stepCount: 2 },
      { id: 'disabled', name: 'Disabled', description: 'disabled', enabled: false, stepCount: 1 },
    ])

    const result = JSON.parse(await executeWorkflowSearch({ query: 'ignored' }))

    expect(result).toEqual([
      expect.objectContaining({
        id: 'contact-normalize',
        stepCount: 2,
      }),
    ])
  })

  it('executeWorkflowRead should record read workflow ids', async () => {
    vi.spyOn(workflowsRepo, 'readWorkflow').mockResolvedValue(createWorkflow())
    const readWorkflowIds = new Set<string>()

    const result = JSON.parse(await executeWorkflowRead({ workflowId: 'contact-normalize' }, readWorkflowIds))

    expect(readWorkflowIds.has('contact-normalize')).toBe(true)
    expect(result.steps).toEqual([
      expect.objectContaining({
        id: 'extract',
        skillId: 'extract-contact-skill',
      }),
    ])
  })

  it('executeWorkflowRun should reject execution before workflow_read', async () => {
    const runWorkflowSpy = vi.spyOn(workflowRuntimeService, 'runWorkflow')
    const result = await executeWorkflowRun(
      { workflowId: 'contact-normalize', input: { text: 'raw' } },
      new Set(),
    )

    expect(result).toContain('必须先调用 workflow_read')
    expect(runWorkflowSpy).not.toHaveBeenCalled()
  })

  it('executeWorkflowRun should run workflow after workflow_read', async () => {
    vi.spyOn(workflowsRepo, 'readWorkflow').mockResolvedValue(createWorkflow())
    const runWorkflowSpy = vi.spyOn(workflowRuntimeService, 'runWorkflow').mockResolvedValue({
      ok: true,
      output: '联系人：张三',
      steps: [],
    })

    const result = JSON.parse(
      await executeWorkflowRun(
        { workflowId: 'contact-normalize', input: { text: '张三，邮箱 zhangsan@example.com' } },
        new Set(['contact-normalize']),
      ),
    )

    expect(runWorkflowSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'contact-normalize' }),
      { text: '张三，邮箱 zhangsan@example.com' },
    )
    expect(result).toMatchObject({
      ok: true,
      output: '联系人：张三',
    })
  })
})
