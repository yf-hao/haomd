import { normalizeSkillBeforeSave } from '../application/skillsService'
import type { SkillDocument } from '../domain/types'
import { saveSkill } from '../storage/skillsRepo'
import type { SkillArtifact } from './types'

type SkillJsonScript = {
  id: string
  label: string
  runtime: string
  entry: string
  approval_policy: string
  args_schema?: string | null
}

type SkillJsonDocument = {
  id: string
  name: string
  description?: string | null
  enabled: boolean
  trusted: boolean
  load_policy: string
  markdown?: string
  scripts: SkillJsonScript[]
}

function parseSkillJson(skillJson: string): SkillJsonDocument {
  return JSON.parse(skillJson) as SkillJsonDocument
}

export function artifactToSkillDocument(artifact: SkillArtifact): SkillDocument {
  const parsed = parseSkillJson(artifact.skillJson)
  const contentByPath = new Map(artifact.scripts.map((script) => [script.path, script.content]))

  return normalizeSkillBeforeSave({
    id: parsed.id,
    name: parsed.name,
    description: parsed.description ?? undefined,
    enabled: parsed.enabled,
    trusted: parsed.trusted,
    loadPolicy: parsed.load_policy === 'on_demand' ? 'on_demand' : 'on_demand',
    markdown: artifact.skillMarkdown,
    scripts: (parsed.scripts ?? []).map((script) => ({
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
      content: contentByPath.get(script.entry) ?? '',
    })),
  })
}

export function skillDocumentToArtifact(doc: SkillDocument): SkillArtifact {
  return {
    skillJson: JSON.stringify(
      {
        id: doc.id,
        name: doc.name,
        description: doc.description ?? '',
        enabled: doc.enabled,
        trusted: doc.trusted,
        load_policy: doc.loadPolicy,
        scripts: doc.scripts.map((script) => ({
          id: script.id,
          label: script.label,
          runtime: script.runtime,
          entry: script.entry,
          approval_policy: script.approvalPolicy,
          args_schema: script.argsSchema ?? '',
        })),
      },
      null,
      2,
    ),
    skillMarkdown: doc.markdown,
    scripts: doc.scripts.map((script) => ({
      path: script.entry,
      content: script.content,
    })),
  }
}

export async function saveSkillArtifact(artifact: SkillArtifact): Promise<SkillDocument> {
  const doc = artifactToSkillDocument(artifact)
  await saveSkill(doc)
  return doc
}
