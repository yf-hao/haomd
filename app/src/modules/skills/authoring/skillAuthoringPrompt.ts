import type { SkillArtifact, ValidationError } from './types'

const OUTPUT_PROTOCOL = `输出必须是严格 JSON 对象，且只能包含以下顶层字段：
{
  "skill": { ... },
  "markdown": "...",
  "scripts": [
    {
      "path": "scripts/run.js",
      "content": "function run(args) { ... }"
    }
  ]
}

约束：
1. description 只写短摘要
2. 详细语义写在 SKILL.md
3. 脚本必须定义 function run(args)
4. 脚本必须返回 ok/stdout/stderr/exitCode
5. 脚本只消费结构化参数，不做自然语言理解
6. 不要输出额外解释`

const SKILL_SHAPE = `Skill 架构：
- skill.json 字段：
  - id
  - name
  - description
  - enabled
  - trusted
  - load_policy
  - scripts[]
- 每个 script 字段：
  - id
  - label
  - runtime
  - entry
  - approval_policy
  - args_schema
- SKILL.md 必须包含：
  - ## 适用场景
  - ## 使用原则
  - ## Scripts
  - 每个脚本对应的 ### <scriptId> 小节`

const FEW_SHOT = `参考样板要点：
- hello-skill：单脚本、单参数、严格结构化参数
- extract-contact-skill：单脚本、输出 JSON 字符串
- wrap-text-skill：多参数、输出严格由入参拼接`

function renderArtifact(artifact: SkillArtifact): string {
  return JSON.stringify(
    {
      skill: JSON.parse(artifact.skillJson),
      markdown: artifact.skillMarkdown,
      scripts: artifact.scripts,
    },
    null,
    2,
  )
}

function renderErrors(errors: ValidationError[]): string {
  return JSON.stringify(errors, null, 2)
}

function buildCommonSystemPrompt(): string {
  return [
    '你正在为 HaoMD 生成或修改 Skill。',
    SKILL_SHAPE,
    OUTPUT_PROTOCOL,
    FEW_SHOT,
  ].join('\n\n')
}

export function buildCreateSkillAuthoringPrompt(input: { userRequest: string }): {
  system: string
  user: string
} {
  return {
    system: buildCommonSystemPrompt(),
    user: `请根据以下需求生成一个新的 HaoMD Skill。\n\n用户需求：\n${input.userRequest}`,
  }
}

export function buildReviseSkillAuthoringPrompt(input: {
  userRequest: string
  currentArtifact: SkillArtifact
}): {
  system: string
  user: string
} {
  return {
    system: buildCommonSystemPrompt(),
    user:
      '请基于当前 Skill 做增量修改，保留未被要求修改的正确部分，并输出完整结果。\n\n' +
      `用户修改要求：\n${input.userRequest}\n\n` +
      `当前 Skill：\n${renderArtifact(input.currentArtifact)}`,
  }
}

export function buildRepairSkillAuthoringPrompt(input: {
  userRequest: string
  currentArtifact: SkillArtifact
  validationErrors: ValidationError[]
}): {
  system: string
  user: string
} {
  return {
    system: buildCommonSystemPrompt(),
    user:
      '下面的 Skill 草稿未通过校验。请保留已正确的内容，只修复错误项，并输出完整修正后的结果。\n\n' +
      `原始需求：\n${input.userRequest}\n\n` +
      `当前草稿：\n${renderArtifact(input.currentArtifact)}\n\n` +
      `校验错误：\n${renderErrors(input.validationErrors)}`,
  }
}
