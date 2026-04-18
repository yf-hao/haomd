import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSkillsToolCatalogPrompt } from './skillsToolCatalog'
import { listSkills } from '../../skills/storage/skillsRepo'

vi.mock('../../skills/storage/skillsRepo', () => ({
  listSkills: vi.fn(),
}))

const mockedListSkills = vi.mocked(listSkills)

describe('buildSkillsToolCatalogPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return empty string when no enabled skills exist', async () => {
    mockedListSkills.mockResolvedValue([])

    await expect(buildSkillsToolCatalogPrompt()).resolves.toBe('')
  })

  it('should include generic workflow rules and trusted/untrusted skill lists', async () => {
    mockedListSkills.mockResolvedValue([
      {
        id: 'hello-skill',
        name: 'Hello Skill',
        description: '问候语测试 skill',
        enabled: true,
        trusted: true,
        scriptCount: 1,
      },
      {
        id: 'unsafe-skill',
        name: 'Unsafe Skill',
        description: '未授权脚本',
        enabled: true,
        trusted: false,
        scriptCount: 1,
      },
      {
        id: 'disabled-skill',
        name: 'Disabled Skill',
        description: 'disabled',
        enabled: false,
        trusted: false,
        scriptCount: 0,
      },
    ])

    const prompt = await buildSkillsToolCatalogPrompt()

    expect(prompt).toContain('先 skills_search，再 skills_read')
    expect(prompt).toContain('脚本级工具')
    expect(prompt).toContain('根据该 skill 的 SKILL.md 和 argsSchema')
    expect(prompt).toContain('hello-skill: Hello Skill — 问候语测试 skill [trusted]')
    expect(prompt).toContain('unsafe-skill: Unsafe Skill — 未授权脚本 [untrusted]')
    expect(prompt).not.toContain('disabled-skill')
    expect(prompt).toContain('可直接自动执行的 trusted skills：hello-skill')
    expect(prompt).toContain('未自动授权执行的 skills：unsafe-skill')
  })
})
