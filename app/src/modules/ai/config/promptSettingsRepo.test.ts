import { describe, it, expect, vi, beforeEach } from 'vitest'
import { emptyPromptSettings, type PromptSettingsState } from '../domain/types'
import { fromCfg, toCfg, loadPromptSettingsState, savePromptSettingsState, type PromptSettingsCfg } from './promptSettingsRepo'
import { mockInvoke } from '../../../../vitest.setup'

describe('promptSettingsRepo fromCfg / toCfg', () => {
  it('fromCfg should return empty settings when cfg is null/undefined', () => {
    expect(fromCfg(null as any)).toEqual(emptyPromptSettings)
    expect(fromCfg(undefined as any)).toEqual(emptyPromptSettings)
  })

  it('fromCfg should map roles and defaultRoleId correctly', () => {
    const cfg: PromptSettingsCfg = {
      roles: [
        {
          id: 'r1',
          name: 'Role 1',
          description: null,
          prompt: 'prompt-1',
          is_default: true,
        },
      ],
      default_role_id: 'r1',
    }

    const state = fromCfg(cfg)
    expect(state.defaultRoleId).toBe('r1')
    expect(state.roles).toHaveLength(1)
    expect(state.roles[0]).toEqual({
      id: 'r1',
      name: 'Role 1',
      description: undefined,
      prompt: 'prompt-1',
      builtin: false,
    })
  })

  it('toCfg should persist only non-builtin roles and mark default', () => {
    const state: PromptSettingsState = {
      roles: [
        {
          id: 'builtin',
          name: 'Builtin',
          description: 'ignored',
          prompt: 'builtin',
          builtin: true,
        },
        {
          id: 'user-1',
          name: 'User 1',
          description: undefined,
          prompt: 'user-prompt',
          builtin: false,
        },
      ],
      defaultRoleId: 'user-1',
    }

    const cfg = toCfg(state)
    expect(cfg.roles).toHaveLength(1)
    expect(cfg.roles[0]).toEqual({
      id: 'user-1',
      name: 'User 1',
      description: null,
      prompt: 'user-prompt',
      is_default: true,
    })
    expect(cfg.default_role_id).toBe('user-1')
  })
})

describe('promptSettingsRepo load/save', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loadPromptSettingsState should return mapped state when backend succeeds', async () => {
    const cfg: PromptSettingsCfg = {
      roles: [
        { id: 'r1', name: 'R1', description: 'd', prompt: 'p', is_default: true },
      ],
      default_role_id: 'r1',
    }

    ;(mockInvoke as any).mockResolvedValueOnce({
      Ok: { data: cfg, trace_id: 't1' },
    })

    const state = await loadPromptSettingsState()

    expect(mockInvoke).toHaveBeenCalledWith('load_prompt_settings')
    expect(state.defaultRoleId).toBe('r1')
    expect(state.roles[0].name).toBe('R1')
  })

  it('loadPromptSettingsState should fallback to empty settings when backend fails', async () => {
    ;(mockInvoke as any).mockResolvedValueOnce({
      Err: { error: { code: 'UNKNOWN', message: 'bad', trace_id: 't2' } },
    })

    const state = await loadPromptSettingsState()
    expect(state).toEqual(emptyPromptSettings)
  })

  it('savePromptSettingsState should invoke backend with converted cfg', async () => {
    const state: PromptSettingsState = {
      roles: [
        { id: 'r1', name: 'R1', description: undefined, prompt: 'p', builtin: false },
      ],
      defaultRoleId: 'r1',
    }

    ;(mockInvoke as any).mockResolvedValueOnce({ Ok: { data: null, trace_id: 't3' } })

    await savePromptSettingsState(state)

    expect(mockInvoke).toHaveBeenCalledWith('save_prompt_settings', {
      cfg: {
        roles: [
          {
            id: 'r1',
            name: 'R1',
            description: null,
            prompt: 'p',
            is_default: true,
          },
        ],
        default_role_id: 'r1',
      },
    })
  })
})
