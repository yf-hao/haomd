import { describe, expect, it, vi } from 'vitest'
import {
  acceptSkillBuildSession,
  applyRawSkillBuildOutput,
  cancelSkillBuildSession,
  createSkillBuildSession,
  runSkillBuildSession,
} from './skillBuildSessionService'

const validArtifact = JSON.stringify({
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
        args_schema: JSON.stringify({
          type: 'object',
          properties: {
            text: {
              type: 'string',
            },
          },
          required: ['text'],
        }),
      },
    ],
  },
  markdown:
    '# Extract Contact\n\n' +
    '## 适用场景\n- 场景 1\n\n' +
    '## 使用原则\n- 规则 1\n\n' +
    '## Scripts\n\n' +
    '### run\n用途：\n- 执行\n',
  scripts: [
    {
      path: 'scripts/run.js',
      content:
        'function run(args) {\n' +
        '  return {\n' +
        '    ok: true,\n' +
        "    stdout: '',\n" +
        "    stderr: '',\n" +
        '    exitCode: 0,\n' +
        '  }\n' +
        '}\n',
    },
  ],
})

describe('skillBuildSessionService', () => {
  it('should create a session with defaults', () => {
    const session = createSkillBuildSession({
      mode: 'create',
      userRequest: '生成一个 skill',
    })

    expect(session.mode).toBe('create')
    expect(session.status).toBe('idle')
    expect(session.maxRepairRounds).toBe(3)
    expect(session.currentDraft).toBeNull()
  })

  it('should move to validated for a valid artifact', () => {
    const session = createSkillBuildSession({
      mode: 'create',
      userRequest: '生成一个 skill',
    })

    const applied = applyRawSkillBuildOutput(session, validArtifact)

    expect(applied.validation.ok).toBe(true)
    expect(applied.session.status).toBe('validated')
    expect(applied.session.currentDraft).not.toBeNull()
  })

  it('should move to repairing for a repairable invalid artifact', () => {
    const session = createSkillBuildSession({
      mode: 'create',
      userRequest: '生成一个 skill',
      maxRepairRounds: 2,
    })

    const applied = applyRawSkillBuildOutput(
      session,
      JSON.stringify({
        skill: {
          id: 'bad-skill',
          name: 'Bad Skill',
          description: 'bad',
          enabled: true,
          trusted: true,
          load_policy: 'on_demand',
          scripts: [],
        },
        markdown: '# Bad Skill',
        scripts: [],
      }),
    )

    expect(applied.validation.ok).toBe(false)
    expect(applied.session.status).toBe('repairing')
    expect(applied.session.validationErrors.length).toBeGreaterThan(0)
  })

  it('should fail after retries are exhausted', async () => {
    const session = createSkillBuildSession({
      mode: 'create',
      userRequest: '生成一个 skill',
      maxRepairRounds: 1,
    })

    const result = await runSkillBuildSession(session, {
      generate: async () => '{"skill":{}}',
      repair: async () => '{"skill":{}}',
    })

    expect(result.status).toBe('failed')
    expect(result.failureReason).toBe('parse_failed')
  })

  it('should repair once and then validate successfully', async () => {
    const session = createSkillBuildSession({
      mode: 'create',
      userRequest: '生成一个 skill',
      maxRepairRounds: 2,
    })

    const generate = vi.fn(
      async () =>
        JSON.stringify({
          skill: {
            id: 'broken-skill',
            name: 'Broken Skill',
            description: 'bad',
            enabled: true,
            trusted: true,
            load_policy: 'on_demand',
            scripts: [],
          },
          markdown: '# Broken Skill',
          scripts: [],
        }),
    )
    const repair = vi.fn(async () => validArtifact)

    const result = await runSkillBuildSession(session, {
      generate,
      repair,
    })

    expect(generate).toHaveBeenCalledTimes(1)
    expect(repair).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('validated')
    expect(result.repairCount).toBe(1)
  })

  it('should accept a validated session', async () => {
    const base = applyRawSkillBuildOutput(
      createSkillBuildSession({
        mode: 'create',
        userRequest: '生成一个 skill',
      }),
      validArtifact,
    ).session

    const save = vi.fn(async () => {})
    const accepted = await acceptSkillBuildSession(base, save)

    expect(save).toHaveBeenCalledTimes(1)
    expect(accepted.status).toBe('accepted')
  })

  it('should cancel a session', () => {
    const session = createSkillBuildSession({
      mode: 'revise',
      userRequest: '继续修改',
    })

    const cancelled = cancelSkillBuildSession(session)
    expect(cancelled.status).toBe('cancelled')
  })
})
