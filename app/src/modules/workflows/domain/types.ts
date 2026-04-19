export type WorkflowApprovalPolicy = 'ask' | 'always_allow' | 'manual_only'

export type WorkflowFailurePolicy = 'fail_fast' | 'continue'

export type WorkflowStepType = 'skill'

export type WorkflowStep = {
  id: string
  type: WorkflowStepType
  skillId: string
  scriptId: string
  inputTemplate: string
}

export type WorkflowDocument = {
  id: string
  name: string
  description?: string
  enabled: boolean
  approvalPolicy: WorkflowApprovalPolicy
  failurePolicy: WorkflowFailurePolicy
  inputSchema: string
  outputFrom: string
  markdown: string
  steps: WorkflowStep[]
}

export type WorkflowSummary = {
  id: string
  name: string
  description?: string
  enabled: boolean
  stepCount: number
}

export type WorkflowStepRunResult = {
  stepId: string
  skillId: string
  scriptId: string
  resolvedInput: unknown
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  json?: unknown
  error?: string
}

export type WorkflowRunResult = {
  ok: boolean
  output: unknown
  steps: WorkflowStepRunResult[]
  error?: string
}
