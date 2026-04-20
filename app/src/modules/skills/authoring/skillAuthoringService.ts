import { readSkill } from '../storage/skillsRepo'
import { createSkillAuthoringHandlers, type SkillAuthoringProviderContext } from './skillAuthoringClient'
import { acceptSkillBuildSession, cancelSkillBuildSession, createSkillBuildSession, runSkillBuildSession } from './skillBuildSessionService'
import { skillDocumentToArtifact } from './skillArtifactSaveService'
import type { SkillBuildSession } from './types'
import type { IStreamingChatClient } from '../../ai/domain/types'

type StartBuildOptions = {
  maxRepairRounds?: number
  providerContext?: SkillAuthoringProviderContext
  client?: IStreamingChatClient
}

export async function startCreateSkillBuild(
  userRequest: string,
  options: StartBuildOptions = {},
): Promise<SkillBuildSession> {
  const session = createSkillBuildSession({
    mode: 'create',
    userRequest,
    maxRepairRounds: options.maxRepairRounds,
  })

  return runSkillBuildSession(
    session,
    createSkillAuthoringHandlers({
      mode: 'create',
      userRequest,
      context: options.providerContext,
      client: options.client,
    }),
  )
}

export async function startReviseSkillBuild(
  skillId: string,
  userRequest: string,
  options: StartBuildOptions = {},
): Promise<SkillBuildSession> {
  const currentSkill = await readSkill(skillId)
  if (!currentSkill) {
    throw new Error(`Skill 不存在：${skillId}`)
  }

  const currentArtifact = skillDocumentToArtifact(currentSkill)
  const session = createSkillBuildSession({
    mode: 'revise',
    baseSkillId: skillId,
    userRequest,
    currentDraft: currentArtifact,
    maxRepairRounds: options.maxRepairRounds,
  })

  return runSkillBuildSession(
    session,
    createSkillAuthoringHandlers({
      mode: 'revise',
      userRequest,
      currentArtifact,
      context: options.providerContext,
      client: options.client,
    }),
  )
}

export async function continueSkillBuildRefinement(
  session: SkillBuildSession,
  userRequest: string,
  options: StartBuildOptions = {},
): Promise<SkillBuildSession> {
  if (!session.currentDraft) {
    throw new Error('当前 session 没有可继续修改的草稿')
  }

  const nextSession = createSkillBuildSession({
    mode: session.mode,
    baseSkillId: session.baseSkillId,
    userRequest,
    currentDraft: session.currentDraft,
    maxRepairRounds: options.maxRepairRounds ?? session.maxRepairRounds,
  })

  return runSkillBuildSession(
    nextSession,
    createSkillAuthoringHandlers({
      mode: 'revise',
      userRequest,
      currentArtifact: session.currentDraft,
      context: options.providerContext,
      client: options.client,
    }),
  )
}

export { acceptSkillBuildSession as acceptSkillBuild, cancelSkillBuildSession as cancelSkillBuild }
