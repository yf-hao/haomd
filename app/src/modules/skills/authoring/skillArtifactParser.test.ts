import { describe, expect, it } from 'vitest'
import { parseSkillArtifact, tryParseSkillArtifact } from './skillArtifactParser'

const RAW_ARTIFACT = JSON.stringify({
  skill: {
    id: 'extract-contact-skill',
    name: 'Extract Contact',
    description: '联系人信息提取测试 skill',
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
        args_schema: '{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}',
      },
    ],
  },
  markdown: '# Extract Contact Skill',
  scripts: [
    {
      path: 'scripts/run.js',
      content: 'function run(args) { return { ok: true, stdout: "", stderr: "", exitCode: 0 } }',
    },
  ],
})

describe('skillArtifactParser', () => {
  it('should parse a valid skill artifact', () => {
    const parsed = parseSkillArtifact(RAW_ARTIFACT)

    expect(parsed.skill.id).toBe('extract-contact-skill')
    expect(parsed.markdown).toContain('# Extract Contact Skill')
    expect(parsed.scripts[0]?.path).toBe('scripts/run.js')
  })

  it('should report invalid JSON via tryParseSkillArtifact', () => {
    const result = tryParseSkillArtifact('{invalid json')

    expect(result.artifact).toBeNull()
    expect(result.errors[0]?.code).toBe('invalid_artifact')
  })
})
