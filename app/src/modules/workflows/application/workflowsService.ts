import type { WorkflowDocument, WorkflowStep } from '../domain/types'

function slugify(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || `workflow-${Date.now()}`
}

export function createDefaultWorkflowStep(index: number): WorkflowStep {
  const id = index <= 1 ? 'step-1' : `step-${index}`
  return {
    id,
    type: 'skill',
    skillId: '',
    scriptId: 'run',
    inputTemplate:
      '{\n' +
      '  "text": "{{input.text}}"\n' +
      '}',
  }
}

export function createDefaultWorkflow(): WorkflowDocument {
  const id = `workflow-${Date.now()}`
  return {
    id,
    name: 'New Workflow',
    description: '一句短摘要',
    enabled: true,
    approvalPolicy: 'ask',
    failurePolicy: 'fail_fast',
    inputSchema:
      '{\n' +
      '  "type": "object",\n' +
      '  "properties": {\n' +
      '    "text": {\n' +
      '      "type": "string",\n' +
      '      "description": "workflow 输入正文"\n' +
      '    }\n' +
      '  },\n' +
      '  "required": ["text"]\n' +
      '}',
    outputFrom: 'steps.step-1.stdout',
    markdown:
      '# New Workflow\n\n' +
      '一句话说明这个 workflow 做什么。\n\n' +
      '## 适用场景\n' +
      '- 场景 1\n' +
      '- 场景 2\n\n' +
      '## 输入要求\n' +
      '- 说明 workflow 输入是什么\n\n' +
      '## Steps\n\n' +
      '### step-1\n' +
      '用途：\n' +
      '- 这个步骤负责什么\n\n' +
      '输入：\n' +
      '- 说明这个步骤消费什么输入\n\n' +
      '输出：\n' +
      '- 说明这个步骤产出什么结果\n',
    steps: [createDefaultWorkflowStep(1)],
  }
}

export function normalizeWorkflowBeforeSave(workflow: WorkflowDocument): WorkflowDocument {
  const nextId = slugify(workflow.id || workflow.name)
  return {
    ...workflow,
    id: nextId,
    name: workflow.name.trim() || 'Untitled Workflow',
    description: workflow.description?.trim() || '',
    inputSchema: workflow.inputSchema || '',
    outputFrom: workflow.outputFrom.trim() || '',
    markdown: workflow.markdown || '# New Workflow\n',
    steps: workflow.steps.map((step, index) => {
      const stepId = slugify(step.id || `step-${index + 1}`)
      return {
        ...step,
        id: stepId,
        type: 'skill',
        skillId: step.skillId.trim(),
        scriptId: step.scriptId.trim() || 'run',
        inputTemplate: step.inputTemplate || '{}',
      }
    }),
  }
}

export function createWorkflowRunInputTemplate(inputSchemaText: string): string {
  if (!inputSchemaText.trim()) return '{}'
  try {
    const schema = JSON.parse(inputSchemaText) as {
      type?: string
      properties?: Record<string, { type?: string }>
    }
    if (schema.type !== 'object' || !schema.properties) return '{}'
    const template = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => {
        if (value?.type === 'number' || value?.type === 'integer') return [key, 0]
        if (value?.type === 'boolean') return [key, false]
        if (value?.type === 'array') return [key, []]
        if (value?.type === 'object') return [key, {}]
        return [key, '']
      }),
    )
    return JSON.stringify(template, null, 2)
  } catch {
    return '{}'
  }
}
