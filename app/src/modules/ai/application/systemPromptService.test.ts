import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadSystemPromptInfo, getSystemPromptByRoleId } from './systemPromptService'
import { loadPromptSettingsStateWithBuiltin } from '../promptSettings'
import type { PromptRole } from '../domain/types'

vi.mock('../promptSettings', () => ({
    loadPromptSettingsStateWithBuiltin: vi.fn(),
}))

describe('systemPromptService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    const mockRoles: PromptRole[] = [
        { id: 'r1', name: 'Role 1', prompt: 'Prompt 1', builtin: true },
        { id: 'r2', name: 'Role 2', prompt: 'Prompt 2 ', builtin: false },
    ]

    describe('loadSystemPromptInfo', () => {
        it('should return empty roles if none exist', async () => {
            vi.mocked(loadPromptSettingsStateWithBuiltin).mockResolvedValue({
                roles: [],
                defaultRoleId: undefined
            })

            const info = await loadSystemPromptInfo()
            expect(info.roles).toEqual([])
            expect(info.activeRoleId).toBeUndefined()
        })

        it('should load roles and use defaultRoleId', async () => {
            vi.mocked(loadPromptSettingsStateWithBuiltin).mockResolvedValue({
                roles: mockRoles,
                defaultRoleId: 'r2'
            })

            const info = await loadSystemPromptInfo()
            expect(info.roles).toEqual(mockRoles)
            expect(info.activeRoleId).toBe('r2')
            expect(info.systemPrompt).toBe('Prompt 2') // trimmed
        })

        it('should use first role if defaultRoleId is missing', async () => {
            vi.mocked(loadPromptSettingsStateWithBuiltin).mockResolvedValue({
                roles: mockRoles,
            })

            const info = await loadSystemPromptInfo()
            expect(info.activeRoleId).toBe('r1')
            expect(info.systemPrompt).toBe('Prompt 1')
        })
    })

    describe('getSystemPromptByRoleId', () => {
        it('should return undefined if no roles', () => {
            const result = getSystemPromptByRoleId([], 'any')
            expect(result.activeRoleId).toBeUndefined()
            expect(result.systemPrompt).toBeUndefined()
        })

        it('should return prompt for existing role', () => {
            const result = getSystemPromptByRoleId(mockRoles, 'r2')
            expect(result.activeRoleId).toBe('r2')
            expect(result.systemPrompt).toBe('Prompt 2')
        })

        it('should return first role if roleId is missing', () => {
            const result = getSystemPromptByRoleId(mockRoles)
            expect(result.activeRoleId).toBe('r1')
            expect(result.systemPrompt).toBe('Prompt 1')
        })

        it('should return undefined activeRoleId if role not found', () => {
            const result = getSystemPromptByRoleId(mockRoles, 'non-existent')
            expect(result.activeRoleId).toBeUndefined()
            expect(result.systemPrompt).toBeUndefined()
        })
    })
})
