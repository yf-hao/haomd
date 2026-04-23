import type { WordTemplateConfig } from '../export/word/template/types'

export type TemplateValidationError = {
  file: string
  code: string
  path?: string
  message: string
}

export type WordTemplateDraft = {
  templateId: string
  templateName: string
  templateRequest: string
  templateJson: WordTemplateConfig
  usageMarkdown: string
  sampleMarkdown: string
}

export type WordTemplateBuildMode = 'create' | 'revise'

export type WordTemplateBuildStatus =
  | 'idle'
  | 'generating'
  | 'validating'
  | 'repairing'
  | 'validated'
  | 'accepted'
  | 'failed'
  | 'cancelled'

export type WordTemplateBuildSession = {
  id: string
  mode: WordTemplateBuildMode
  baseTemplateId?: string
  userRequest: string
  currentDraft: WordTemplateDraft | null
  status: WordTemplateBuildStatus
  repairCount: number
  maxRepairRounds: number
  validationErrors: TemplateValidationError[]
  failureReason?: string
}

export type ParsedWordTemplateArtifact = {
  templateId: string
  templateName: string
  templateJson: WordTemplateConfig
  usageMarkdown: string
  sampleMarkdown: string
}

export type WordTemplateValidationResult = {
  ok: boolean
  errors: TemplateValidationError[]
}
