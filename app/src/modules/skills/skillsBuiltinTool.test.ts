import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildDynamicSkillScriptTools,
  executeSkillsRead,
  executeSkillsRun,
  executeSkillsSearch,
} from './skillsBuiltinTool'
import * as skillsRepo from './storage/skillsRepo'
import * as skillsRuntimeService from './application/skillsRuntimeService'
import type { SkillDocument } from './domain/types'

function createSkill(overrides: Partial<SkillDocument> = {}): SkillDocument {
  return {
    id: 'hello-skill',
    name: 'Hello Skill',
    description: '问候语测试 skill',
    enabled: true,
    trusted: true,
    loadPolicy: 'on_demand',
    markdown: '# Hello Skill',
    scripts: [
      {
        id: 'run',
        label: 'Run',
        runtime: 'builtin-js',
        entry: 'scripts/run.js',
        approvalPolicy: 'always_allow',
        argsSchema: JSON.stringify({
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
          required: ['name'],
        }),
        content: 'function run(args) { return args }',
      },
    ],
    ...overrides,
  }
}

describe('skillsBuiltinTool', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('executeSkillsSearch should return enabled skills only', async () => {
    vi.spyOn(skillsRepo, 'listSkills').mockResolvedValue([
      {
        id: 'hello-skill',
        name: 'Hello Skill',
        description: '问候语测试 skill',
        enabled: true,
        trusted: true,
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

    const result = JSON.parse(await executeSkillsSearch({ query: 'ignored' }))

    expect(result).toEqual([
      expect.objectContaining({
        id: 'hello-skill',
        trusted: true,
        runnable: true,
      }),
    ])
  })

  it('executeSkillsRead should record read skill id and expose script toolName', async () => {
    vi.spyOn(skillsRepo, 'readSkill').mockResolvedValue(createSkill())
    const readSkillIds = new Set<string>()

    const result = JSON.parse(await executeSkillsRead({ skillId: 'hello-skill' }, readSkillIds))

    expect(readSkillIds.has('hello-skill')).toBe(true)
    expect(result.scripts).toEqual([
      expect.objectContaining({
        id: 'run',
        toolName: 'skill__hello_skill__run',
        runnable: true,
      }),
    ])
  })

  it('executeSkillsRun should reject execution before skills_read', async () => {
    const runSkillScriptSpy = vi.spyOn(skillsRuntimeService, 'runSkillScript')
    const result = await executeSkillsRun(
      { skillId: 'hello-skill', scriptId: 'run', args: { name: '张三' } },
      new Set(),
    )

    expect(result).toContain('必须先调用 skills_read')
    expect(runSkillScriptSpy).not.toHaveBeenCalled()
  })

  it('executeSkillsRun should flatten top-level args for script execution', async () => {
    vi.spyOn(skillsRepo, 'readSkill').mockResolvedValue(createSkill())
    const runSkillScriptSpy = vi.spyOn(skillsRuntimeService, 'runSkillScript').mockResolvedValue({
      ok: true,
      stdout: 'Hello, 张三!',
      stderr: '',
      exitCode: 0,
    })

    const result = JSON.parse(
      await executeSkillsRun(
        { skillId: 'hello-skill', scriptId: 'run', name: '张三' },
        new Set(['hello-skill']),
      ),
    )

    expect(runSkillScriptSpy).toHaveBeenCalledWith('hello-skill', 'run', { name: '张三' })
    expect(result).toEqual({
      ok: true,
      stdout: 'Hello, 张三!',
      stderr: '',
      exitCode: 0,
    })
  })

  it('buildDynamicSkillScriptTools should derive concrete tools from read trusted skills', async () => {
    vi.spyOn(skillsRepo, 'readSkill').mockResolvedValue(
      createSkill({
        scripts: [
          {
            id: 'run',
            label: 'Run',
            runtime: 'builtin-js',
            entry: 'scripts/run.js',
            approvalPolicy: 'always_allow',
            argsSchema: '{"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}',
            content: '',
          },
          {
            id: 'manual',
            label: 'Manual',
            runtime: 'builtin-js',
            entry: 'scripts/manual.js',
            approvalPolicy: 'manual_only',
            argsSchema: '{"type":"object"}',
            content: '',
          },
        ],
      }),
    )

    const tools = await buildDynamicSkillScriptTools(['hello-skill'])

    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({
      toolName: 'skill__hello_skill__run',
      skillId: 'hello-skill',
      scriptId: 'run',
      tool: {
        type: 'function',
        function: {
          name: 'skill__hello_skill__run',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string' },
            },
            required: ['name'],
          },
        },
      },
    })
  })

  it('buildDynamicSkillScriptTools should truncate overly long tool names', async () => {
    vi.spyOn(skillsRepo, 'readSkill').mockResolvedValue(
      createSkill({
        id: 'very-long-skill-id-that-keeps-growing-beyond-the-tool-name-limit',
        scripts: [
          {
            id: 'very-long-script-id-that-also-keeps-growing-beyond-the-limit',
            label: 'Run',
            runtime: 'builtin-js',
            entry: 'scripts/run.js',
            approvalPolicy: 'always_allow',
            argsSchema: '{"type":"object"}',
            content: '',
          },
        ],
      }),
    )

    const tools = await buildDynamicSkillScriptTools([
      'very-long-skill-id-that-keeps-growing-beyond-the-tool-name-limit',
    ])

    expect(tools[0].toolName.length).toBeLessThanOrEqual(64)
    expect(tools[0].tool.function.name.length).toBeLessThanOrEqual(64)
  })
})
