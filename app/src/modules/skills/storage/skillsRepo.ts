import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../../platform/backendTypes'
import type { SkillDocument, SkillSummary } from '../domain/types'

type SkillScriptCfg = {
  id: string
  label: string
  runtime: string
  entry: string
  approval_policy: string
  args_schema?: string | null
  content: string
}

type SkillDocumentCfg = {
  id: string
  name: string
  description?: string | null
  enabled: boolean
  trusted: boolean
  load_policy: string
  markdown: string
  scripts: SkillScriptCfg[]
}

type SkillSummaryCfg = {
  id: string
  name: string
  description?: string | null
  enabled: boolean
  trusted: boolean
  script_count: number
}

function fromSummaryCfg(cfg: SkillSummaryCfg): SkillSummary {
  return {
    id: cfg.id,
    name: cfg.name,
    description: cfg.description ?? undefined,
    enabled: cfg.enabled,
    trusted: cfg.trusted,
    scriptCount: cfg.script_count,
  }
}

function fromDocumentCfg(cfg: SkillDocumentCfg): SkillDocument {
  return {
    id: cfg.id,
    name: cfg.name,
    description: cfg.description ?? undefined,
    enabled: cfg.enabled,
    trusted: cfg.trusted,
    loadPolicy: cfg.load_policy === 'on_demand' ? 'on_demand' : 'on_demand',
    markdown: cfg.markdown,
    scripts: (cfg.scripts ?? []).map((script) => ({
      id: script.id,
      label: script.label,
      runtime: script.runtime,
      entry: script.entry,
      approvalPolicy:
        script.approval_policy === 'always_allow'
          ? 'always_allow'
          : script.approval_policy === 'manual_only'
            ? 'manual_only'
            : 'ask',
      argsSchema: script.args_schema ?? undefined,
      content: script.content,
    })),
  }
}

function toDocumentCfg(doc: SkillDocument): SkillDocumentCfg {
  return {
    id: doc.id,
    name: doc.name,
    description: doc.description ?? null,
    enabled: doc.enabled,
    trusted: doc.trusted,
    load_policy: doc.loadPolicy,
    markdown: doc.markdown,
    scripts: doc.scripts.map((script) => ({
      id: script.id,
      label: script.label,
      runtime: script.runtime,
      entry: script.entry,
      approval_policy: script.approvalPolicy,
      args_schema: script.argsSchema ?? null,
      content: script.content,
    })),
  }
}

export async function listSkills(): Promise<SkillSummary[]> {
  const resp = await invoke<BackendResult<SkillSummaryCfg[]>>('list_skills')
  if ('Ok' in resp) {
    return (resp.Ok.data ?? []).map(fromSummaryCfg)
  }
  throw new Error(resp.Err.error.message)
}

export async function readSkill(skillId: string): Promise<SkillDocument | null> {
  const resp = await invoke<BackendResult<SkillDocumentCfg | null>>('read_skill', { skillId })
  if ('Ok' in resp) {
    return resp.Ok.data ? fromDocumentCfg(resp.Ok.data) : null
  }
  throw new Error(resp.Err.error.message)
}

export async function saveSkill(doc: SkillDocument): Promise<void> {
  const resp = await invoke<BackendResult<null>>('save_skill', { cfg: toDocumentCfg(doc) })
  if (!('Ok' in resp)) {
    throw new Error(resp.Err.error.message)
  }
}

export async function deleteSkill(skillId: string): Promise<void> {
  const resp = await invoke<BackendResult<null>>('delete_skill', { skillId })
  if (!('Ok' in resp)) {
    throw new Error(resp.Err.error.message)
  }
}

