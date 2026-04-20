import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IStreamingChatClient, StreamingChatRequest, StreamingChatResult } from '../../ai/domain/types'
import { readSkill } from '../storage/skillsRepo'
import { acceptSkillBuild, cancelSkillBuild, continueSkillBuildRefinement, startCreateSkillBuild, startReviseSkillBuild } from './skillAuthoringService'
import { artifactToSkillDocument, skillDocumentToArtifact } from './skillArtifactSaveService'
import type { SkillArtifact } from './types'

vi.mock('../storage/skillsRepo', () => ({
  readSkill: vi.fn(),
}))

const validArtifact: SkillArtifact = {
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
        args_schema: JSON.stringify({
          type: 'object',
          properties: {
            name: {
              type: 'string',
            },
          },
          required: ['name'],
        }),
      },
    ],
  }),
  skillMarkdown:
    '# Hello Skill\n\n' +
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
}

function createMockClient(output: string): IStreamingChatClient {
  return {
    askStream: vi.fn(async (_request: StreamingChatRequest, handlers): Promise<StreamingChatResult> => {
      handlers.onChunk?.({ content: output })
      handlers.onComplete?.(output, output.length)
      return {
        content: output,
        tokenCount: output.length,
        completed: true,
      }
    }),
  }
}

describe('skillAuthoringService', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('should start a create build and return a validated session', async () => {
    const session = await startCreateSkillBuild('生成一个问候 skill', {
      client: createMockClient(
        JSON.stringify({
          skill: JSON.parse(validArtifact.skillJson),
          markdown: validArtifact.skillMarkdown,
          scripts: validArtifact.scripts,
        }),
      ),
    })

    expect(session.status).toBe('validated')
    expect(session.currentDraft?.skillJson).toContain('"hello-skill"')
  })

  it('should start a revise build from an existing skill', async () => {
    ;(readSkill as ReturnType<typeof vi.fn>).mockResolvedValue(artifactToSkillDocument(validArtifact))

    const session = await startReviseSkillBuild('hello-skill', '把输出改成 JSON', {
      client: createMockClient(
        JSON.stringify({
          skill: JSON.parse(validArtifact.skillJson),
          markdown: validArtifact.skillMarkdown,
          scripts: validArtifact.scripts,
        }),
      ),
    })

    expect(readSkill).toHaveBeenCalledWith('hello-skill')
    expect(session.status).toBe('validated')
    expect(session.baseSkillId).toBe('hello-skill')
  })

  it('should continue refinement from an existing validated session', async () => {
    const baseSession = await startCreateSkillBuild('生成一个问候 skill', {
      client: createMockClient(
        JSON.stringify({
          skill: JSON.parse(validArtifact.skillJson),
          markdown: validArtifact.skillMarkdown,
          scripts: validArtifact.scripts,
        }),
      ),
    })

    const next = await continueSkillBuildRefinement(baseSession, '把输出改成 JSON', {
      client: createMockClient(
        JSON.stringify({
          skill: JSON.parse(validArtifact.skillJson),
          markdown: validArtifact.skillMarkdown,
          scripts: validArtifact.scripts,
        }),
      ),
    })

    expect(next.status).toBe('validated')
    expect(next.userRequest).toBe('把输出改成 JSON')
  })

  it('should re-export accept and cancel helpers', async () => {
    const baseSession = await startCreateSkillBuild('生成一个问候 skill', {
      client: createMockClient(
        JSON.stringify({
          skill: JSON.parse(validArtifact.skillJson),
          markdown: validArtifact.skillMarkdown,
          scripts: validArtifact.scripts,
        }),
      ),
    })

    const accepted = await acceptSkillBuild(baseSession, async () => {})
    const cancelled = cancelSkillBuild(baseSession)

    expect(accepted.status).toBe('accepted')
    expect(cancelled.status).toBe('cancelled')
  })

  it('should convert a saved skill document back to artifact for revise mode', () => {
    const artifact = skillDocumentToArtifact(artifactToSkillDocument(validArtifact))
    expect(artifact.skillJson).toContain('"hello-skill"')
    expect(artifact.scripts[0]?.path).toBe('scripts/run.js')
  })
})
