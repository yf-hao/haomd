import { createWordTemplateAuthoringHandlers, type WordTemplateAuthoringProviderContext } from './templateAuthoringClient'
import {
  acceptWordTemplateBuildSession,
  cancelWordTemplateBuildSession,
  createWordTemplateBuildSession,
  runWordTemplateBuildSession,
} from './templateBuildSessionService'
import type { WordTemplateBuildSession, WordTemplateDraft } from './types'
import type { IStreamingChatClient } from '../ai/domain/types'

type StartBuildOptions = {
  maxRepairRounds?: number
  providerContext?: WordTemplateAuthoringProviderContext
  client?: IStreamingChatClient
}

export async function startCreateWordTemplateBuild(
  userRequest: string,
  options: StartBuildOptions = {},
): Promise<WordTemplateBuildSession> {
  const session = createWordTemplateBuildSession({
    mode: 'create',
    userRequest,
    maxRepairRounds: options.maxRepairRounds,
  })

  return runWordTemplateBuildSession(
    session,
    createWordTemplateAuthoringHandlers({
      mode: 'create',
      userRequest,
      context: options.providerContext,
      client: options.client,
    }),
  )
}

export async function startReviseWordTemplateBuild(
  currentDraft: WordTemplateDraft,
  userRequest: string,
  options: StartBuildOptions = {},
): Promise<WordTemplateBuildSession> {
  const session = createWordTemplateBuildSession({
    mode: 'revise',
    baseTemplateId: currentDraft.templateId,
    userRequest,
    currentDraft,
    maxRepairRounds: options.maxRepairRounds,
  })

  return runWordTemplateBuildSession(
    session,
    createWordTemplateAuthoringHandlers({
      mode: 'revise',
      userRequest,
      currentDraft,
      context: options.providerContext,
      client: options.client,
    }),
  )
}

export async function continueWordTemplateBuildRefinement(
  session: WordTemplateBuildSession,
  userRequest: string,
  options: StartBuildOptions = {},
): Promise<WordTemplateBuildSession> {
  if (!session.currentDraft) {
    throw new Error('当前 session 没有可继续修改的草稿')
  }

  const nextSession = createWordTemplateBuildSession({
    mode: session.mode,
    baseTemplateId: session.baseTemplateId,
    userRequest,
    currentDraft: session.currentDraft,
    maxRepairRounds: options.maxRepairRounds ?? session.maxRepairRounds,
  })

  return runWordTemplateBuildSession(
    nextSession,
    createWordTemplateAuthoringHandlers({
      mode: 'revise',
      userRequest,
      currentDraft: session.currentDraft,
      context: options.providerContext,
      client: options.client,
    }),
  )
}

export {
  acceptWordTemplateBuildSession as acceptWordTemplateBuild,
  cancelWordTemplateBuildSession as cancelWordTemplateBuild,
}
