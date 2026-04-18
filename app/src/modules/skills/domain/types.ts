export type SkillRuntimeId = string

export type SkillApprovalPolicy = 'ask' | 'always_allow' | 'manual_only'

export type SkillLoadPolicy = 'on_demand'

export type SkillScript = {
  id: string
  label: string
  runtime: SkillRuntimeId
  entry: string
  approvalPolicy: SkillApprovalPolicy
  argsSchema?: string
  content: string
}

export type SkillDocument = {
  id: string
  name: string
  description?: string
  enabled: boolean
  trusted: boolean
  loadPolicy: SkillLoadPolicy
  markdown: string
  scripts: SkillScript[]
}

export type SkillSummary = {
  id: string
  name: string
  description?: string
  enabled: boolean
  trusted: boolean
  scriptCount: number
}

