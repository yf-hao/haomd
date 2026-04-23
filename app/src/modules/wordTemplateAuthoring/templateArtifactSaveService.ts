import { invoke } from '@tauri-apps/api/core'
import type { WordTemplateConfig } from '../export/word/template/types'
import type { WordTemplateDraft } from './types'

export type WordTemplateDocument = {
  templateId: string
  templateName: string
  templateRequest: string
  templateJson: WordTemplateConfig
  usageMarkdown: string
  sampleMarkdown: string
}

type WordTemplateAuthoringMetadata = {
  templateRequest?: string
  sampleMarkdown?: string
}

export function draftToWordTemplateDocument(draft: WordTemplateDraft): WordTemplateDocument {
  return {
    templateId: draft.templateId,
    templateName: draft.templateName,
    templateRequest: draft.templateRequest,
    templateJson: draft.templateJson,
    usageMarkdown: draft.usageMarkdown,
    sampleMarkdown: draft.sampleMarkdown,
  }
}

export function wordTemplateDocumentToDraft(doc: WordTemplateDocument): WordTemplateDraft {
  return {
    templateId: doc.templateId,
    templateName: doc.templateName,
    templateRequest: doc.templateRequest,
    templateJson: doc.templateJson,
    usageMarkdown: doc.usageMarkdown,
    sampleMarkdown: doc.sampleMarkdown,
  }
}

export async function loadWordTemplateDraft(templateId: string): Promise<WordTemplateDraft> {
  const [configJson, usageMarkdown, authoringRaw] = await Promise.all([
    invoke<string>('get_word_template_config', { templateId }),
    invoke<string>('get_word_template_notes', { templateId }),
    invoke<string>('get_word_template_authoring_metadata', { templateId }),
  ])

  const templateJson = JSON.parse(configJson) as WordTemplateConfig
  const authoring = JSON.parse(authoringRaw) as WordTemplateAuthoringMetadata
  return {
    templateId: templateJson.templateId,
    templateName: templateJson.name?.trim() || templateId,
    templateRequest: authoring.templateRequest?.trim() || '',
    templateJson,
    usageMarkdown,
    sampleMarkdown: authoring.sampleMarkdown || '',
  }
}

export async function saveWordTemplateDraft(draft: WordTemplateDraft): Promise<WordTemplateDocument> {
  const doc = draftToWordTemplateDocument(draft)
  await invoke('save_word_template_artifacts', {
    templateId: doc.templateId,
    templateJson: JSON.stringify(doc.templateJson, null, 2),
    usageMarkdown: doc.usageMarkdown,
    templateRequest: doc.templateRequest,
    sampleMarkdown: doc.sampleMarkdown,
  })
  return doc
}
