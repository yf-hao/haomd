import { describe, it, expect } from 'vitest'
import {
    emptySettings,
    emptyPromptSettings,
    builtinPromptRoles,
    builtinPromptSettings
} from './types'

describe('AI Domain Types and Constants', () => {
    it('should have a valid emptySettings constant', () => {
        expect(emptySettings).toEqual({
            providers: [],
            defaultProviderId: undefined,
        })
    })

    it('should have a valid emptyPromptSettings constant', () => {
        expect(emptyPromptSettings).toEqual({
            roles: [],
            defaultRoleId: undefined,
        })
    })

    it('should have builtin prompt roles defined', () => {
        expect(builtinPromptRoles.length).toBeGreaterThan(0)
        const defaultRole = builtinPromptRoles.find(r => r.name === '默认')
        expect(defaultRole).toBeDefined()
        expect(defaultRole?.builtin).toBe(true)
        expect(defaultRole?.prompt).toContain('百科全书级专家')
    })

    it('should have a valid builtinPromptSettings pointing to the default role', () => {
        expect(builtinPromptSettings.roles).toEqual(builtinPromptRoles)
        expect(builtinPromptSettings.defaultRoleId).toBe(builtinPromptRoles[0].id)
    })

    it('should include "提示词优化专家" in builtin roles', () => {
        const optimizerRole = builtinPromptRoles.find(r => r.name === '提示词优化专家')
        expect(optimizerRole).toBeDefined()
        expect(optimizerRole?.prompt).toContain('master-level AI prompt optimization specialist')
    })
})
