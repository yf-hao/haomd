import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../../platform/backendTypes'
import type { WorkflowDocument, WorkflowSummary } from '../domain/types'

type WorkflowStepCfg = {
  id: string
  type: string
  skill_id: string
  script_id: string
  input_template: string
}

type WorkflowDocumentCfg = {
  id: string
  name: string
  description?: string | null
  enabled: boolean
  approval_policy: string
  failure_policy: string
  input_schema: string
  output_from: string
  markdown: string
  steps: WorkflowStepCfg[]
}

type WorkflowSummaryCfg = {
  id: string
  name: string
  description?: string | null
  enabled: boolean
  step_count: number
}

function fromSummaryCfg(cfg: WorkflowSummaryCfg): WorkflowSummary {
  return {
    id: cfg.id,
    name: cfg.name,
    description: cfg.description ?? undefined,
    enabled: cfg.enabled,
    stepCount: cfg.step_count,
  }
}

function fromDocumentCfg(cfg: WorkflowDocumentCfg): WorkflowDocument {
  return {
    id: cfg.id,
    name: cfg.name,
    description: cfg.description ?? undefined,
    enabled: cfg.enabled,
    approvalPolicy:
      cfg.approval_policy === 'always_allow'
        ? 'always_allow'
        : cfg.approval_policy === 'manual_only'
          ? 'manual_only'
          : 'ask',
    failurePolicy: cfg.failure_policy === 'continue' ? 'continue' : 'fail_fast',
    inputSchema: cfg.input_schema ?? '',
    outputFrom: cfg.output_from ?? '',
    markdown: cfg.markdown,
    steps: (cfg.steps ?? []).map((step) => ({
      id: step.id,
      type: step.type === 'skill' ? 'skill' : 'skill',
      skillId: step.skill_id,
      scriptId: step.script_id,
      inputTemplate: step.input_template ?? '',
    })),
  }
}

function toDocumentCfg(doc: WorkflowDocument): WorkflowDocumentCfg {
  return {
    id: doc.id,
    name: doc.name,
    description: doc.description ?? null,
    enabled: doc.enabled,
    approval_policy: doc.approvalPolicy,
    failure_policy: doc.failurePolicy,
    input_schema: doc.inputSchema,
    output_from: doc.outputFrom,
    markdown: doc.markdown,
    steps: doc.steps.map((step) => ({
      id: step.id,
      type: step.type,
      skill_id: step.skillId,
      script_id: step.scriptId,
      input_template: step.inputTemplate,
    })),
  }
}

export async function listWorkflows(): Promise<WorkflowSummary[]> {
  const resp = await invoke<BackendResult<WorkflowSummaryCfg[]>>('list_workflows')
  if ('Ok' in resp) {
    return (resp.Ok.data ?? []).map(fromSummaryCfg)
  }
  throw new Error(resp.Err.error.message)
}

export async function readWorkflow(workflowId: string): Promise<WorkflowDocument | null> {
  const resp = await invoke<BackendResult<WorkflowDocumentCfg | null>>('read_workflow', { workflowId })
  if ('Ok' in resp) {
    return resp.Ok.data ? fromDocumentCfg(resp.Ok.data) : null
  }
  throw new Error(resp.Err.error.message)
}

export async function saveWorkflow(doc: WorkflowDocument): Promise<void> {
  const resp = await invoke<BackendResult<null>>('save_workflow', { cfg: toDocumentCfg(doc) })
  if (!('Ok' in resp)) {
    throw new Error(resp.Err.error.message)
  }
}

export async function deleteWorkflow(workflowId: string): Promise<void> {
  const resp = await invoke<BackendResult<null>>('delete_workflow', { workflowId })
  if (!('Ok' in resp)) {
    throw new Error(resp.Err.error.message)
  }
}
