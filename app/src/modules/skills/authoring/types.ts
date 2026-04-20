export type SkillArtifactScript = {
  path: string
  content: string
}

export type SkillArtifact = {
  skillJson: string
  skillMarkdown: string
  scripts: SkillArtifactScript[]
}

export type ValidationError = {
  file: string
  code: string
  path?: string
  message: string
}

export type SkillBuildMode = 'create' | 'revise'

export type SkillBuildStatus =
  | 'idle'
  | 'generating'
  | 'validating'
  | 'repairing'
  | 'validated'
  | 'accepted'
  | 'failed'
  | 'cancelled'

export type SkillBuildSession = {
  id: string
  mode: SkillBuildMode
  baseSkillId?: string
  userRequest: string
  currentDraft: SkillArtifact | null
  status: SkillBuildStatus
  repairCount: number
  maxRepairRounds: number
  validationErrors: ValidationError[]
  failureReason?: string
}

export type ParsedSkillArtifact = {
  skill: {
    id: string
    name: string
    description?: string
    enabled: boolean
    trusted: boolean
    load_policy: string
    scripts: Array<{
      id: string
      label: string
      runtime: string
      entry: string
      approval_policy: string
      args_schema?: string
    }>
  }
  markdown: string
  scripts: SkillArtifactScript[]
}

export type SkillValidationResult = {
  ok: boolean
  errors: ValidationError[]
}
