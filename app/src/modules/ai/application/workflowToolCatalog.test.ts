import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildWorkflowToolCatalogPrompt } from './workflowToolCatalog'
import * as workflowsRepo from '../../workflows/storage/workflowsRepo'

describe('buildWorkflowToolCatalogPrompt', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('should return empty string when no enabled workflows exist', async () => {
    vi.spyOn(workflowsRepo, 'listWorkflows').mockResolvedValue([])

    await expect(buildWorkflowToolCatalogPrompt()).resolves.toBe('')
  })

  it('should include generic workflow rules and enabled workflow list', async () => {
    vi.spyOn(workflowsRepo, 'listWorkflows').mockResolvedValue([
      {
        id: 'contact-normalize',
        name: 'Contact Normalize',
        description: '提取并规范化联系人信息',
        enabled: true,
        stepCount: 2,
      },
      {
        id: 'disabled-workflow',
        name: 'Disabled Workflow',
        description: 'disabled',
        enabled: false,
        stepCount: 1,
      },
    ])

    const prompt = await buildWorkflowToolCatalogPrompt()

    expect(prompt).toContain('先 workflow_search，再 workflow_read，再 workflow_run')
    expect(prompt).toContain('workflow_run 有硬约束')
    expect(prompt).toContain('inputSchema')
    expect(prompt).toContain('contact-normalize: Contact Normalize — 提取并规范化联系人信息')
    expect(prompt).not.toContain('disabled-workflow')
  })
})
