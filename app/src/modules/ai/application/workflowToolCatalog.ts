import { listWorkflows } from '../../workflows/storage/workflowsRepo'

export async function buildWorkflowToolCatalogPrompt(): Promise<string> {
  const workflows = (await listWorkflows()).filter((workflow) => workflow.enabled)
  if (!workflows.length) return ''

  return (
    '\n\n当前可用 Workflows。\n' +
    '当用户请求明显需要多个 skill 顺序执行、固定编排流程或多步自动化时，应优先考虑 Workflow，而不是自行临时编排。\n' +
    '推荐顺序：先 workflow_search，再 workflow_read，再 workflow_run。\n' +
    '注意：workflow_run 有硬约束，运行前必须先读取对应 workflow。\n' +
    '在运行前，应根据 workflow_read 返回的 inputSchema 整理结构化输入，不要把多余解释性文本混入 input。\n\n' +
    '已启用 Workflows：\n' +
    workflows
      .map((workflow) => `- ${workflow.id}: ${workflow.name}${workflow.description ? ` — ${workflow.description}` : ''}`)
      .join('\n')
  )
}
