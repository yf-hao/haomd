import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IStreamingChatClient, StreamingChatRequest, StreamingChatResult } from '../../ai/domain/types'
import { createStreamingClientFromSettings } from '../../ai/streamingClientFactory'
import { loadAiSettingsState } from '../../ai/config/aiSettingsRepo'
import {
  createSkillAuthoringHandlers,
  generateSkillArtifactDraft,
  repairSkillArtifactDraft,
  reviseSkillArtifactDraft,
} from './skillAuthoringClient'
import type { SkillArtifact, ValidationError } from './types'

vi.mock('../../ai/config/aiSettingsRepo', () => ({
  loadAiSettingsState: vi.fn(),
}))

vi.mock('../../ai/streamingClientFactory', () => ({
  createStreamingClientFromSettings: vi.fn(),
}))

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

function createMockClient(output = '{"skill":{}}'): IStreamingChatClient {
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

describe('skillAuthoringClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('should use injected client and prepend system prompt as a message', async () => {
    const client = createMockClient('{"ok":true}')

    const result = await generateSkillArtifactDraft('生成一个问候 skill', undefined, client)

    expect(result).toBe('{"ok":true}')
    expect(client.askStream).toHaveBeenCalledTimes(1)
    const askStreamMock = client.askStream as ReturnType<typeof vi.fn>
    const [request] = askStreamMock.mock.calls[0] ?? []
    expect(request.messages[0]?.content).toContain('你正在为 HaoMD 生成或修改 Skill')
    expect(request.messages[1]?.content).toContain('生成一个新的 HaoMD Skill')
  })

  it('should create a real provider client from current default provider', async () => {
    const factoryClient = createMockClient('{"ok":true}')
    const loadAiSettingsStateMock = loadAiSettingsState as ReturnType<typeof vi.fn>
    const createStreamingClientMock = createStreamingClientFromSettings as ReturnType<typeof vi.fn>

    loadAiSettingsStateMock.mockResolvedValue({
      providers: [
        {
          id: 'p1',
          name: 'Provider 1',
          baseUrl: 'https://example.com',
          apiKey: 'k',
          models: [{ id: 'm1' }],
          defaultModelId: 'm1',
          providerType: 'openai',
        },
      ],
      defaultProviderId: 'p1',
    })
    createStreamingClientMock.mockReturnValue(factoryClient)

    await generateSkillArtifactDraft('生成一个联系人提取 skill')

    expect(createStreamingClientFromSettings).toHaveBeenCalledTimes(1)
    const [provider, systemPrompt, modelId] = createStreamingClientMock.mock.calls[0] ?? []
    expect(provider.id).toBe('p1')
    expect(systemPrompt).toContain('你正在为 HaoMD 生成或修改 Skill')
    expect(modelId).toBe('m1')
  })

  it('should support revise and repair prompts', async () => {
    const client = createMockClient('{"ok":true}')

    await reviseSkillArtifactDraft('把输出改成 JSON', artifact, undefined, client)
    await repairSkillArtifactDraft('修复这个 skill', artifact, validationErrors, undefined, client)

    expect(client.askStream).toHaveBeenCalledTimes(2)
    const askStreamMock = client.askStream as ReturnType<typeof vi.fn>
    const reviseRequest = askStreamMock.mock.calls[0]?.[0]
    const repairRequest = askStreamMock.mock.calls[1]?.[0]
    expect(reviseRequest?.messages[1]?.content).toContain('增量修改')
    expect(repairRequest?.messages[1]?.content).toContain('未通过校验')
  })

  it('should build create and repair handlers', async () => {
    const client = createMockClient('{"ok":true}')
    const handlers = createSkillAuthoringHandlers({
      mode: 'revise',
      userRequest: '继续修改 skill',
      currentArtifact: artifact,
      client,
    })

    await handlers.generate({ session: {} as any })
    await handlers.repair({
      session: {
        currentDraft: artifact,
        validationErrors,
      } as any,
    })

    expect(client.askStream).toHaveBeenCalledTimes(2)
  })
})
