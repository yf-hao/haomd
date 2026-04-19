import type { OpenAIToolDef } from '../ai/domain/types'
import { readWorkflow, listWorkflows } from './storage/workflowsRepo'
import { runWorkflow } from './application/workflowRuntimeService'

export const WORKFLOW_SEARCH_TOOL_NAME = 'workflow_search'
export const WORKFLOW_READ_TOOL_NAME = 'workflow_read'
export const WORKFLOW_RUN_TOOL_NAME = 'workflow_run'

export const workflowSearchToolSchema: OpenAIToolDef = {
  type: 'function',
  function: {
    name: WORKFLOW_SEARCH_TOOL_NAME,
    description:
      '列出当前已启用的 Workflows。' +
      '当用户请求明显需要多步技能编排、顺序执行多个 skill 或固定自动化流程时，先调用此工具查看可用 workflow。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '可选搜索关键词，仅用于帮助你做选择；当前工具会返回所有已启用 workflows。',
        },
      },
      required: [],
    },
  },
}

export const workflowReadToolSchema: OpenAIToolDef = {
  type: 'function',
  function: {
    name: WORKFLOW_READ_TOOL_NAME,
    description:
      '读取某个 Workflow 的详细说明、输入要求、步骤摘要和输出映射。' +
      '在运行 workflow 之前，必须先调用此工具读取对应 workflow。',
    parameters: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description: 'Workflow ID，例如“contact-normalize”。',
        },
      },
      required: ['workflowId'],
    },
  },
}

export const workflowRunToolSchema: OpenAIToolDef = {
  type: 'function',
  function: {
    name: WORKFLOW_RUN_TOOL_NAME,
    description:
      '运行某个 Workflow。' +
      '调用前必须先 workflow_read。' +
      '参数 input 必须是符合该 workflow inputSchema 的结构化 JSON 对象。',
    parameters: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description: 'Workflow ID，例如“contact-normalize”。',
        },
        input: {
          type: 'object',
          description: '传给 workflow 的结构化输入对象，必须遵循该 workflow 的 inputSchema。',
        },
      },
      required: ['workflowId', 'input'],
    },
  },
}

export async function executeWorkflowSearch(args: { query?: string }): Promise<string> {
  void args.query
  const workflows = (await listWorkflows())
    .filter((workflow) => workflow.enabled)
    .sort((left, right) => left.name.localeCompare(right.name))

  return JSON.stringify(
    workflows.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      description: workflow.description ?? '',
      stepCount: workflow.stepCount,
    })),
    null,
    2,
  )
}

export async function executeWorkflowRead(
  args: { workflowId?: string },
  readWorkflowIds?: Set<string>,
): Promise<string> {
  const workflowId = args.workflowId?.trim() ?? ''
  if (!workflowId) {
    return '⚠️ 未提供 workflowId。'
  }

  const workflow = await readWorkflow(workflowId)
  if (!workflow || !workflow.enabled) {
    return `⚠️ 未找到已启用的 Workflow：${workflowId}`
  }
  readWorkflowIds?.add(workflow.id)

  return JSON.stringify(
    {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description ?? '',
      approvalPolicy: workflow.approvalPolicy,
      failurePolicy: workflow.failurePolicy,
      inputSchema: workflow.inputSchema,
      outputFrom: workflow.outputFrom,
      markdown: workflow.markdown,
      steps: workflow.steps.map((step) => ({
        id: step.id,
        type: step.type,
        skillId: step.skillId,
        scriptId: step.scriptId,
        inputTemplate: step.inputTemplate,
      })),
      runnable: workflow.approvalPolicy !== 'manual_only',
    },
    null,
    2,
  )
}

export async function executeWorkflowRun(
  args: { workflowId?: string; input?: unknown },
  readWorkflowIds?: Set<string>,
): Promise<string> {
  const workflowId = args.workflowId?.trim() ?? ''
  if (!workflowId) {
    return '⚠️ 未提供 workflowId。'
  }
  if (!readWorkflowIds?.has(workflowId)) {
    return `⚠️ 执行 ${workflowId} 前，必须先调用 workflow_read 读取该 Workflow 的说明。`
  }

  const workflow = await readWorkflow(workflowId)
  if (!workflow || !workflow.enabled) {
    return `⚠️ 未找到已启用的 Workflow：${workflowId}`
  }
  if (workflow.approvalPolicy === 'manual_only') {
    return `⚠️ Workflow ${workflowId} 仅允许手动运行，当前自动工具调用已拒绝。`
  }

  const result = await runWorkflow(workflow, args.input ?? {})
  return JSON.stringify(result, null, 2)
}
