import { describe, expect, it } from 'vitest'
import { validateSkillArtifact } from './skillValidationService'
import type { SkillArtifact } from './types'

function createArtifact(overrides: Partial<SkillArtifact> = {}): SkillArtifact {
  return {
    skillJson: JSON.stringify({
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
    }, null, 2),
    skillMarkdown:
      '# Extract Contact Skill\n\n' +
      '## 适用场景\n- 场景 1\n\n' +
      '## 使用原则\n- 原则 1\n\n' +
      '## Scripts\n\n' +
      '### run\n用途：\n- 提取联系人\n',
    scripts: [
      {
        path: 'scripts/run.js',
        content:
          'function run(args) {\n' +
          '  return { ok: true, stdout: "", stderr: "", exitCode: 0 }\n' +
          '}\n',
      },
    ],
    ...overrides,
  }
}

describe('skillValidationService', () => {
  it('should pass for a structurally valid artifact', () => {
    const result = validateSkillArtifact(createArtifact())

    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should report missing sections and invalid script shape', () => {
    const result = validateSkillArtifact(
      createArtifact({
        skillMarkdown: '# Bad Skill',
        scripts: [
          {
            path: 'scripts/run.js',
            content: 'const x = 1',
          },
        ],
      }),
    )

    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.code === 'missing_section')).toBe(true)
    expect(result.errors.some((error) => error.code === 'missing_run_function')).toBe(true)
  })

  it('should report invalid args_schema and missing script file', () => {
    const result = validateSkillArtifact(
      createArtifact({
        skillJson: JSON.stringify({
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
              entry: 'scripts/missing.js',
              approval_policy: 'always_allow',
              args_schema: '{invalid json',
            },
          ],
        }),
      }),
    )

    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.code === 'invalid_args_schema')).toBe(true)
    expect(result.errors.some((error) => error.code === 'missing_script_file')).toBe(true)
  })
})
