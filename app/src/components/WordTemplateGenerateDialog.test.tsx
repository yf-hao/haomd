// @vitest-environment jsdom

import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '../modules/i18n/I18nContext'
import { WordTemplateGenerateDialog } from './WordTemplateGenerateDialog'
import type { WordTemplateBuildSession, WordTemplateDraft } from '../modules/wordTemplateAuthoring/types'
import * as wordTemplateAuthoringService from '../modules/wordTemplateAuthoring/templateAuthoringService'
import * as wordTemplateSaveService from '../modules/wordTemplateAuthoring/templateArtifactSaveService'

function renderWithI18n(node: ReactNode) {
  return render(
    <I18nProvider value={{ languageMode: 'zh-CN', resolvedLanguage: 'zh-CN' }}>
      {node}
    </I18nProvider>,
  )
}

function createDraft(templateId = 'meeting-notes'): WordTemplateDraft {
  return {
    templateId,
    templateName: '会议纪要模板',
    templateRequest: '生成一个会议纪要模板',
    templateJson: {
      templateId,
      name: '会议纪要模板',
      bindings: [
        {
          field: 'meta.title',
          placeholder: '{{title}}',
          type: 'text',
          source: {
            kind: 'frontMatter',
            key: 'title',
          },
        },
      ],
    },
    usageMarkdown: '# 使用说明\n\n请在 front matter 中填写 title。\n正文使用标题组织章节。',
    sampleMarkdown: '---\ntitle: 周会\n---\n\n# 决议\n\n内容',
  }
}

function createValidatedSession(templateId = 'meeting-notes'): WordTemplateBuildSession {
  return {
    id: 'word-template-build-1',
    mode: 'create',
    userRequest: '生成一个模板',
    currentDraft: createDraft(templateId),
    status: 'validated',
    repairCount: 0,
    maxRepairRounds: 3,
    validationErrors: [],
  }
}

describe('WordTemplateGenerateDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('should start create flow and render validated preview', async () => {
    vi.spyOn(wordTemplateAuthoringService, 'startCreateWordTemplateBuild').mockResolvedValue(
      createValidatedSession(),
    )

    renderWithI18n(
      <WordTemplateGenerateDialog
        open
        mode="create"
        onClose={() => {}}
      />,
    )

    fireEvent.change(screen.getByLabelText('模板需求'), {
      target: { value: '生成一个会议纪要模板' },
    })
    fireEvent.click(screen.getByText('开始生成'))

    await waitFor(() => {
      expect(wordTemplateAuthoringService.startCreateWordTemplateBuild).toHaveBeenCalledWith(
        '生成一个会议纪要模板',
      )
    })

    expect(await screen.findByDisplayValue(/meeting-notes/)).toBeDefined()
    expect(screen.getByText('已通过校验')).toBeDefined()
  })

  it('should call accept and onAccepted for a validated draft', async () => {
    vi.spyOn(wordTemplateAuthoringService, 'startCreateWordTemplateBuild').mockResolvedValue(
      createValidatedSession('accepted-template'),
    )
    vi.spyOn(wordTemplateAuthoringService, 'acceptWordTemplateBuild').mockResolvedValue({
      ...createValidatedSession('accepted-template'),
      status: 'accepted',
    })
    vi.spyOn(wordTemplateSaveService, 'saveWordTemplateDraft').mockResolvedValue({
      templateId: 'accepted-template',
      templateName: '会议纪要模板',
      templateRequest: '生成一个纪要模板',
      templateJson: createDraft('accepted-template').templateJson,
      usageMarkdown: createDraft('accepted-template').usageMarkdown,
      sampleMarkdown: createDraft('accepted-template').sampleMarkdown,
    })

    const onAccepted = vi.fn()
    const onClose = vi.fn()

    renderWithI18n(
      <WordTemplateGenerateDialog
        open
        mode="create"
        onClose={onClose}
        onAccepted={onAccepted}
      />,
    )

    fireEvent.change(screen.getByLabelText('模板需求'), {
      target: { value: '生成一个纪要模板' },
    })
    fireEvent.click(screen.getByText('开始生成'))

    await screen.findByText('接受并保存')
    fireEvent.click(screen.getByText('接受并保存'))

    await waitFor(() => {
      expect(wordTemplateAuthoringService.acceptWordTemplateBuild).toHaveBeenCalledTimes(1)
      expect(onAccepted).toHaveBeenCalledWith('accepted-template')
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('should start revise flow when mode is revise', async () => {
    vi.spyOn(wordTemplateSaveService, 'loadWordTemplateDraft').mockResolvedValue(createDraft('meeting-notes'))
    vi.spyOn(wordTemplateAuthoringService, 'startReviseWordTemplateBuild').mockResolvedValue(
      createValidatedSession('meeting-notes'),
    )

    renderWithI18n(
      <WordTemplateGenerateDialog
        open
        mode="revise"
        templateId="meeting-notes"
        onClose={() => {}}
      />,
    )

    fireEvent.change(screen.getByLabelText('模板需求'), {
      target: { value: '增加决议章节' },
    })
    fireEvent.click(screen.getByText('开始生成'))

    await waitFor(() => {
      expect(wordTemplateSaveService.loadWordTemplateDraft).toHaveBeenCalledWith('meeting-notes')
      expect(wordTemplateAuthoringService.startReviseWordTemplateBuild).toHaveBeenCalledTimes(1)
    })
  })

  it('should preload current draft when opening revise mode', async () => {
    vi.spyOn(wordTemplateSaveService, 'loadWordTemplateDraft').mockResolvedValue(createDraft('meeting-notes'))

    renderWithI18n(
      <WordTemplateGenerateDialog
        open
        mode="revise"
        templateId="meeting-notes"
        onClose={() => {}}
      />,
    )

    await waitFor(() => {
      expect(wordTemplateSaveService.loadWordTemplateDraft).toHaveBeenCalledWith('meeting-notes')
    })

    expect(await screen.findByDisplayValue(/meeting-notes/)).toBeDefined()
    expect(screen.getByDisplayValue(/请在 front matter 中填写 title/)).toBeDefined()
    expect(screen.getByDisplayValue('生成一个会议纪要模板')).toBeDefined()
  })
})
