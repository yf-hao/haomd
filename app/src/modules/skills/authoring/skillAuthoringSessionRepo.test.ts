import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearPersistedSkillAuthoringState,
  loadPersistedSkillAuthoringState,
  savePersistedSkillAuthoringState,
} from './skillAuthoringSessionRepo'
import type { SkillBuildSession } from './types'

function createSession(id: string): SkillBuildSession {
  return {
    id,
    mode: 'create',
    userRequest: '生成一个 skill',
    currentDraft: null,
    status: 'validated',
    repairCount: 0,
    maxRepairRounds: 3,
    validationErrors: [],
  }
}

describe('skillAuthoringSessionRepo', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('should save and load create mode state', () => {
    savePersistedSkillAuthoringState({
      mode: 'create',
      request: '生成问候 skill',
      session: createSession('create-1'),
    })

    expect(loadPersistedSkillAuthoringState('create')).toEqual({
      mode: 'create',
      request: '生成问候 skill',
      session: createSession('create-1'),
    })
  })

  it('should keep revise states isolated by skill id', () => {
    savePersistedSkillAuthoringState({
      mode: 'revise',
      skillId: 'skill-a',
      request: '修改 A',
      session: createSession('revise-a'),
    })
    savePersistedSkillAuthoringState({
      mode: 'revise',
      skillId: 'skill-b',
      request: '修改 B',
      session: createSession('revise-b'),
    })

    expect(loadPersistedSkillAuthoringState('revise', 'skill-a')?.request).toBe('修改 A')
    expect(loadPersistedSkillAuthoringState('revise', 'skill-b')?.request).toBe('修改 B')
  })

  it('should clear persisted state by mode', () => {
    savePersistedSkillAuthoringState({
      mode: 'create',
      request: '生成问候 skill',
      session: createSession('create-1'),
    })
    clearPersistedSkillAuthoringState('create')
    expect(loadPersistedSkillAuthoringState('create')).toBeNull()
  })

  it('should clear persisted revise state by skill id', () => {
    savePersistedSkillAuthoringState({
      mode: 'revise',
      skillId: 'skill-a',
      request: '修改 A',
      session: createSession('revise-a'),
    })

    clearPersistedSkillAuthoringState('revise', 'skill-a')
    expect(loadPersistedSkillAuthoringState('revise', 'skill-a')).toBeNull()
  })
})
