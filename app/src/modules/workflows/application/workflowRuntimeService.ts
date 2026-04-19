import { runSkillScript } from '../../skills/application/skillsRuntimeService'
import type { WorkflowDocument, WorkflowRunResult, WorkflowStepRunResult } from '../domain/types'
import { resolveWorkflowReference, resolveWorkflowTemplateValue } from './workflowTemplateResolver'

type SkillRunner = typeof runSkillScript

function parseJsonText<T>(label: string, text: string): T {
  try {
    return JSON.parse(text) as T
  } catch (error) {
    throw new Error(`${label} 不是合法 JSON: ${String(error)}`)
  }
}

function validateWorkflowInput(inputSchemaText: string, input: unknown) {
  if (!inputSchemaText.trim()) return
  const schema = parseJsonText<Record<string, unknown>>('Workflow inputSchema', inputSchemaText)
  if (schema.type === 'object' && (input == null || typeof input !== 'object' || Array.isArray(input))) {
    throw new Error('Workflow 输入必须是 JSON object')
  }
  const required = Array.isArray(schema.required) ? schema.required : []
  for (const field of required) {
    if (typeof field !== 'string') continue
    if (input == null || typeof input !== 'object' || !(field in input)) {
      throw new Error(`Workflow 输入缺少必填字段: ${field}`)
    }
  }
}

function tryParseStdoutJson(stdout: string): unknown {
  const trimmed = stdout.trim()
  if (!trimmed) return undefined
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    return undefined
  }
}

function buildWorkflowOutput(workflow: WorkflowDocument, steps: WorkflowStepRunResult[]) {
  if (!workflow.outputFrom.trim()) return ''
  const stepMap = Object.fromEntries(steps.map((step) => [step.stepId, step]))
  return resolveWorkflowReference(workflow.outputFrom.trim(), {
    input: {},
    steps: stepMap,
  })
}

export async function runWorkflow(
  workflow: WorkflowDocument,
  input: unknown,
  skillRunner: SkillRunner = runSkillScript,
): Promise<WorkflowRunResult> {
  validateWorkflowInput(workflow.inputSchema, input)

  const steps: WorkflowStepRunResult[] = []
  const stepMap: Record<string, WorkflowStepRunResult> = {}

  for (const step of workflow.steps) {
    let resolvedInput: unknown = {}
    try {
      const template = parseJsonText<unknown>(`步骤 ${step.id} 输入模板`, step.inputTemplate || '{}')
      resolvedInput = resolveWorkflowTemplateValue(template, {
        input,
        steps: stepMap,
      })
    } catch (error) {
      const result: WorkflowStepRunResult = {
        stepId: step.id,
        skillId: step.skillId,
        scriptId: step.scriptId,
        resolvedInput,
        ok: false,
        stdout: '',
        stderr: '',
        exitCode: null,
        error: String(error),
      }
      steps.push(result)
      stepMap[step.id] = result
      if (workflow.failurePolicy === 'fail_fast') {
        return {
          ok: false,
          output: '',
          steps,
          error: result.error,
        }
      }
      continue
    }

    try {
      const response = await skillRunner(step.skillId, step.scriptId, resolvedInput)
      const result: WorkflowStepRunResult = {
        stepId: step.id,
        skillId: step.skillId,
        scriptId: step.scriptId,
        resolvedInput,
        ok: response.ok,
        stdout: response.stdout,
        stderr: response.stderr,
        exitCode: response.exitCode,
        json: tryParseStdoutJson(response.stdout),
        error: response.ok ? undefined : response.stderr || `步骤 ${step.id} 执行失败`,
      }
      steps.push(result)
      stepMap[step.id] = result
      if (!response.ok && workflow.failurePolicy === 'fail_fast') {
        return {
          ok: false,
          output: '',
          steps,
          error: result.error,
        }
      }
    } catch (error) {
      const result: WorkflowStepRunResult = {
        stepId: step.id,
        skillId: step.skillId,
        scriptId: step.scriptId,
        resolvedInput,
        ok: false,
        stdout: '',
        stderr: '',
        exitCode: null,
        error: String(error),
      }
      steps.push(result)
      stepMap[step.id] = result
      if (workflow.failurePolicy === 'fail_fast') {
        return {
          ok: false,
          output: '',
          steps,
          error: result.error,
        }
      }
    }
  }

  const firstError = steps.find((step) => !step.ok)?.error
  return {
    ok: !firstError,
    output: buildWorkflowOutput(workflow, steps),
    steps,
    error: firstError,
  }
}
