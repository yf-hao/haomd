import { describe, expect, it } from 'vitest'
import {
  buildCreateSkillAuthoringPrompt,
  buildRepairSkillAuthoringPrompt,
  buildReviseSkillAuthoringPrompt,
} from './skillAuthoringPrompt'
import type { SkillArtifact, ValidationError } from './types'

const artifact: SkillArtifact = {
  skillJson: JSON.stringify({
    id: 'hello-skill',
    name: 'Hello Skill',
    description: '问候语测试 skill',
    enabled: true,
    trusted: true,
    load_policy: 'on_demand',
    scripts: [
      {
        id: 'run',
        label: 'Run',
        runtime: 'builtin-js',
        entry: 'scripts/run.js',
        approval_policy: 'always_allow',
        args_schema: '{"type":"object"}',
      },
    ],
  }),
  skillMarkdown: '# Hello Skill',
  scripts: [
    {
      path: 'scripts/run.js',
      content: 'function run(args) { return { ok: true, stdout: "", stderr: "", exitCode: 0 } }',
    },
  ],
}

const validationErrors: ValidationError[] = [
  {
    file: 'skill.json',
    code: 'missing_required_field',
    path: 'scripts[0].args_schema',
    message: 'args_schema is required',
  },
]

describe('skillAuthoringPrompt', () => {
  it('should build create prompt with output protocol', () => {
    const prompt = buildCreateSkillAuthoringPrompt({
      userRequest: '生成一个联系人提取 skill',
    })

    expect(prompt.system).toContain('输出必须是严格 JSON 对象')
    expect(prompt.system).toContain('Skill 架构')
    expect(prompt.user).toContain('生成一个新的 HaoMD Skill')
    expect(prompt.user).toContain('联系人提取')
  })

  it('should build revise prompt with current artifact', () => {
    const prompt = buildReviseSkillAuthoringPrompt({
      userRequest: '把输出改成 JSON',
      currentArtifact: artifact,
    })

    expect(prompt.user).toContain('增量修改')
    expect(prompt.user).toContain('把输出改成 JSON')
    expect(prompt.user).toContain('"id": "hello-skill"')
  })

  it('should build repair prompt with validation errors', () => {
    const prompt = buildRepairSkillAuthoringPrompt({
      userRequest: '修复这个 skill',
      currentArtifact: artifact,
      validationErrors,
    })

    expect(prompt.user).toContain('未通过校验')
    expect(prompt.user).toContain('missing_required_field')
    expect(prompt.user).toContain('scripts[0].args_schema')
  })
})
