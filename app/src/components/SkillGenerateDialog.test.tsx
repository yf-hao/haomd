// @vitest-environment jsdom

import type { ReactNode } from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '../modules/i18n/I18nContext'
import { SkillGenerateDialog } from './SkillGenerateDialog'
import type { SkillBuildSession } from '../modules/skills/authoring/types'
import * as skillAuthoringService from '../modules/skills/authoring/skillAuthoringService'

function renderWithI18n(node: ReactNode) {
  return render(
    <I18nProvider value={{ languageMode: 'zh-CN', resolvedLanguage: 'zh-CN' }}>
      {node}
    </I18nProvider>,
  )
}

function createValidatedSession(skillId = 'generated-skill'): SkillBuildSession {
  return {
    id: 'skill-build-1',
    mode: 'create',
    userRequest: '生成一个 skill',
    currentDraft: {
      skillJson: JSON.stringify({
        id: skillId,
        name: 'Generated Skill',
        description: '一句短摘要',
        enabled: true,
        trusted: true,
        load_policy: 'on_demand',
        scripts: [],
      }),
      skillMarkdown: '# Generated Skill',
      scripts: [
        {
          path: 'scripts/run.js',
          content: 'function run(args) { return { ok: true, stdout: "", stderr: "", exitCode: 0 } }',
        },
      ],
    },
    status: 'validated',
    repairCount: 0,
    maxRepairRounds: 3,
    validationErrors: [],
  }
}

describe('SkillGenerateDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('should start create flow and render validated preview', async () => {
    vi.spyOn(skillAuthoringService, 'startCreateSkillBuild').mockResolvedValue(createValidatedSession())

    renderWithI18n(
      <SkillGenerateDialog
        open
        mode="create"
        onClose={() => {}}
      />,
    )

    fireEvent.change(screen.getByLabelText('需求描述'), {
      target: { value: '生成一个联系人提取 skill' },
    })
    fireEvent.click(screen.getByText('开始生成'))

    await waitFor(() => {
      expect(skillAuthoringService.startCreateSkillBuild).toHaveBeenCalledWith('生成一个联系人提取 skill')
    })

    expect(await screen.findByDisplayValue(/generated-skill/)).toBeDefined()
    expect(screen.getByText('已通过校验')).toBeDefined()
  })

  it('should call accept and onAccepted for a validated draft', async () => {
    vi.spyOn(skillAuthoringService, 'startCreateSkillBuild').mockResolvedValue(createValidatedSession('accepted-skill'))
    vi.spyOn(skillAuthoringService, 'acceptSkillBuild').mockResolvedValue({
      ...createValidatedSession('accepted-skill'),
      status: 'accepted',
    })

    const onAccepted = vi.fn()
    const onClose = vi.fn()

    renderWithI18n(
      <SkillGenerateDialog
        open
        mode="create"
        onClose={onClose}
        onAccepted={onAccepted}
      />,
    )

    fireEvent.change(screen.getByLabelText('需求描述'), {
      target: { value: '生成一个问候 skill' },
    })
    fireEvent.click(screen.getByText('开始生成'))

    await screen.findByText('接受并保存')
    fireEvent.click(screen.getByText('接受并保存'))

    await waitFor(() => {
      expect(skillAuthoringService.acceptSkillBuild).toHaveBeenCalledTimes(1)
      expect(onAccepted).toHaveBeenCalledWith('accepted-skill')
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('should start revise flow when mode is revise', async () => {
    vi.spyOn(skillAuthoringService, 'startReviseSkillBuild').mockResolvedValue(createValidatedSession('revise-skill'))

    renderWithI18n(
      <SkillGenerateDialog
        open
        mode="revise"
        skillId="hello-skill"
        onClose={() => {}}
      />,
    )

    fireEvent.change(screen.getByLabelText('需求描述'), {
      target: { value: '把输出改成 JSON' },
    })
    fireEvent.click(screen.getByText('开始生成'))

    await waitFor(() => {
      expect(skillAuthoringService.startReviseSkillBuild).toHaveBeenCalledWith('hello-skill', '把输出改成 JSON')
    })
  })

  it('should continue refine from validated session', async () => {
    vi.spyOn(skillAuthoringService, 'startCreateSkillBuild').mockResolvedValue(createValidatedSession())
    vi.spyOn(skillAuthoringService, 'continueSkillBuildRefinement').mockResolvedValue({
      ...createValidatedSession('refined-skill'),
      userRequest: '继续细化',
    })

    renderWithI18n(
      <SkillGenerateDialog
        open
        mode="create"
        onClose={() => {}}
      />,
    )

    fireEvent.change(screen.getByLabelText('需求描述'), {
      target: { value: '生成一个问候 skill' },
    })
    fireEvent.click(screen.getByText('开始生成'))
    await screen.findByText('继续修改')

    fireEvent.change(screen.getByLabelText('需求描述'), {
      target: { value: '继续细化' },
    })
    fireEvent.click(screen.getByText('继续修改'))

    await waitFor(() => {
      expect(skillAuthoringService.continueSkillBuildRefinement).toHaveBeenCalledTimes(1)
    })
  })
})
