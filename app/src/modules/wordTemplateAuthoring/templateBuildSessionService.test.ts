import { describe, expect, it, vi } from 'vitest'
import {
  acceptWordTemplateBuildSession,
  applyRawWordTemplateBuildOutput,
  cancelWordTemplateBuildSession,
  createWordTemplateBuildSession,
  runWordTemplateBuildSession,
} from './templateBuildSessionService'

const validDraft = JSON.stringify({
  templateId: 'meeting-notes',
  templateName: '会议纪要模板',
  templateJson: {
    templateId: 'meeting-notes',
    name: '会议纪要模板',
    bindings: [
      {
        field: 'meta.title',
        placeholder: '{{title}}',
        type: 'text',
        source: {
          kind: 'frontMatter',
          key: 'title',
        },
      },
      {
        field: 'sections.decisions',
        placeholder: '{{decisions}}',
        type: 'richText',
        source: {
          kind: 'heading',
          match: '决议',
        },
      },
    ],
  },
  usageMarkdown:
    '# 使用说明\n\n' +
    '- front matter 中填写 `title`\n' +
    '- 使用 `# 决议` 标题组织正文\n' +
    '- `meta.title` 对应 front matter 的 `title`\n' +
    '- `sections.decisions` 对应标题为 `决议` 的章节\n',
  sampleMarkdown:
    '---\n' +
    'title: 周会纪要\n' +
    '---\n\n' +
    '# 决议\n\n' +
    '本周结论。\n',
})

describe('templateBuildSessionService', () => {
  it('should create a session with defaults', () => {
    const session = createWordTemplateBuildSession({
      mode: 'create',
      userRequest: '生成一个模板',
    })

    expect(session.mode).toBe('create')
    expect(session.status).toBe('idle')
    expect(session.maxRepairRounds).toBe(3)
    expect(session.currentDraft).toBeNull()
  })

  it('should move to validated for a valid draft', () => {
    const session = createWordTemplateBuildSession({
      mode: 'create',
      userRequest: '生成一个模板',
    })

    const applied = applyRawWordTemplateBuildOutput(session, validDraft)

    expect(applied.validation.ok).toBe(true)
    expect(applied.session.status).toBe('validated')
    expect(applied.session.currentDraft).not.toBeNull()
  })

  it('should move to repairing for a repairable invalid draft', () => {
    const session = createWordTemplateBuildSession({
      mode: 'create',
      userRequest: '生成一个模板',
      maxRepairRounds: 2,
    })

    const applied = applyRawWordTemplateBuildOutput(
      session,
      JSON.stringify({
        templateId: 'broken',
        templateName: '坏模板',
        templateJson: {
          templateId: 'broken',
          name: '坏模板',
          bindings: [],
        },
        usageMarkdown: '# 使用说明',
        sampleMarkdown: '无标题',
      }),
    )

    expect(applied.validation.ok).toBe(false)
    expect(applied.session.status).toBe('repairing')
    expect(applied.session.validationErrors.length).toBeGreaterThan(0)
  })

  it('should fail after retries are exhausted', async () => {
    const session = createWordTemplateBuildSession({
      mode: 'create',
      userRequest: '生成一个模板',
      maxRepairRounds: 1,
    })

    const result = await runWordTemplateBuildSession(session, {
      generate: async () => '{invalid json',
      repair: async () => '{invalid json',
    })

    expect(result.status).toBe('failed')
    expect(result.failureReason).toBe('parse_failed')
  })

  it('should repair once and then validate successfully', async () => {
    const session = createWordTemplateBuildSession({
      mode: 'create',
      userRequest: '生成一个模板',
      maxRepairRounds: 2,
    })

    const generate = vi.fn(
      async () =>
        JSON.stringify({
          templateId: 'broken',
          templateName: '坏模板',
          templateJson: {
            templateId: 'broken',
            name: '坏模板',
            bindings: [],
          },
          usageMarkdown: '# 使用说明',
          sampleMarkdown: '无标题',
        }),
    )
    const repair = vi.fn(async () => validDraft)

    const result = await runWordTemplateBuildSession(session, {
      generate,
      repair,
    })

    expect(generate).toHaveBeenCalledTimes(1)
    expect(repair).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('validated')
    expect(result.repairCount).toBe(1)
  })

  it('should accept a validated session', async () => {
    const base = applyRawWordTemplateBuildOutput(
      createWordTemplateBuildSession({
        mode: 'create',
        userRequest: '生成一个模板',
      }),
      validDraft,
    ).session

    const save = vi.fn(async () => {})
    const accepted = await acceptWordTemplateBuildSession(base, save)

    expect(save).toHaveBeenCalledTimes(1)
    expect(accepted.status).toBe('accepted')
  })

  it('should cancel a session', () => {
    const session = createWordTemplateBuildSession({
      mode: 'revise',
      userRequest: '继续修改',
    })

    const cancelled = cancelWordTemplateBuildSession(session)
    expect(cancelled.status).toBe('cancelled')
  })
})
