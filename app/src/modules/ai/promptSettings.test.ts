import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadPromptSettingsStateWithBuiltin } from './promptSettings'
import { builtinPromptRoles } from './domain/types'

vi.mock('./config/promptSettingsRepo', async () => {
    const actual = await vi.importActual('./config/promptSettingsRepo') as any
    return {
        ...actual,
        loadPromptSettingsState: vi.fn(),
    }
})

import { loadPromptSettingsState } from './config/promptSettingsRepo'

describe('promptSettings', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should merge builtin roles with persisted user roles', async () => {
        const userRole = {
            id: 'user-1',
            name: 'User Role',
            prompt: 'User Prompt',
            builtin: false
        }

        vi.mocked(loadPromptSettingsState).mockResolvedValue({
            roles: [userRole],
            defaultRoleId: 'user-1'
        })

        const state = await loadPromptSettingsStateWithBuiltin()

        expect(state.roles).toHaveLength(builtinPromptRoles.length + 1)
        expect(state.roles).toContainEqual(userRole)
        expect(state.roles[0].id).toBe(builtinPromptRoles[0].id)
        expect(state.defaultRoleId).toBe('user-1')
    })

    it('should fallback to builtin default if persisted default is invalid', async () => {
        vi.mocked(loadPromptSettingsState).mockResolvedValue({
            roles: [],
            defaultRoleId: 'invalid-id'
        })

        const state = await loadPromptSettingsStateWithBuiltin()

        expect(state.defaultRoleId).toBe(builtinPromptRoles[0].id)
    })

    it('should not duplicate roles if user role has same id as builtin', async () => {
        const duplicateRole = {
            id: builtinPromptRoles[0].id,
            name: 'Fake Builtin',
            prompt: 'Fake Prompt',
            builtin: false
        }

        vi.mocked(loadPromptSettingsState).mockResolvedValue({
            roles: [duplicateRole],
        })

        const state = await loadPromptSettingsStateWithBuiltin()

        expect(state.roles).toHaveLength(builtinPromptRoles.length)
        // Should keep the actual builtin one
        expect(state.roles.find(r => r.id === duplicateRole.id)?.builtin).toBe(true)
    })
})
