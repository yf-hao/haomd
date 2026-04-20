import { tryParseSkillArtifact } from './skillArtifactParser'
import { saveSkillArtifact } from './skillArtifactSaveService'
import { validateSkillArtifact } from './skillValidationService'
import type {
  SkillArtifact,
  SkillBuildMode,
  SkillBuildSession,
  SkillValidationResult,
} from './types'

type RunContext = {
  session: SkillBuildSession
}

type BuildSessionHandlers = {
  generate: (context: RunContext) => Promise<string>
  repair: (context: RunContext) => Promise<string>
  save?: (artifact: SkillArtifact) => Promise<void>
}

type ApplyDraftResult = {
  session: SkillBuildSession
  validation: SkillValidationResult
}

function createSessionId(): string {
  return `skill-build-${Date.now()}`
}

export function createSkillBuildSession(input: {
  mode: SkillBuildMode
  userRequest: string
  baseSkillId?: string
  currentDraft?: SkillArtifact | null
  maxRepairRounds?: number
}): SkillBuildSession {
  return {
    id: createSessionId(),
    mode: input.mode,
    baseSkillId: input.baseSkillId,
    userRequest: input.userRequest,
    currentDraft: input.currentDraft ?? null,
    status: 'idle',
    repairCount: 0,
    maxRepairRounds: input.maxRepairRounds ?? 3,
    validationErrors: [],
  }
}

function withStatus(
  session: SkillBuildSession,
  status: SkillBuildSession['status'],
  extra?: Partial<SkillBuildSession>,
): SkillBuildSession {
  return {
    ...session,
    ...extra,
    status,
  }
}

export function applyRawSkillBuildOutput(
  session: SkillBuildSession,
  rawOutput: string,
): ApplyDraftResult {
  const parsed = tryParseSkillArtifact(rawOutput)
  if (!parsed.artifact) {
    return {
      session: withStatus(session, 'failed', {
        validationErrors: parsed.errors,
        failureReason: 'parse_failed',
      }),
      validation: {
        ok: false,
        errors: parsed.errors,
      },
    }
  }

  const validation = validateSkillArtifact(parsed.artifact)
  if (validation.ok) {
    return {
      session: withStatus(session, 'validated', {
        currentDraft: parsed.artifact,
        validationErrors: [],
        failureReason: undefined,
      }),
      validation,
    }
  }

  if (session.repairCount >= session.maxRepairRounds) {
    return {
      session: withStatus(session, 'failed', {
        currentDraft: parsed.artifact,
        validationErrors: validation.errors,
        failureReason: 'validation_failed_after_retries',
      }),
      validation,
    }
  }

  return {
    session: withStatus(session, 'repairing', {
      currentDraft: parsed.artifact,
      validationErrors: validation.errors,
      failureReason: undefined,
    }),
    validation,
  }
}

export async function runSkillBuildSession(
  initialSession: SkillBuildSession,
  handlers: BuildSessionHandlers,
): Promise<SkillBuildSession> {
  let session = withStatus(initialSession, 'generating', {
    validationErrors: [],
    failureReason: undefined,
  })

  for (;;) {
    const rawOutput =
      session.repairCount === 0
        ? await handlers.generate({ session })
        : await handlers.repair({ session })

    session = withStatus(session, 'validating')
    const applied = applyRawSkillBuildOutput(session, rawOutput)
    session = applied.session

    if (session.status === 'validated' || session.status === 'failed') {
      return session
    }

    session = withStatus(session, 'repairing', {
      repairCount: session.repairCount + 1,
    })
  }
}

export async function acceptSkillBuildSession(
  session: SkillBuildSession,
  save: (artifact: SkillArtifact) => Promise<unknown> = saveSkillArtifact,
): Promise<SkillBuildSession> {
  if (session.status !== 'validated' || !session.currentDraft) {
    throw new Error('Only validated sessions can be accepted')
  }

  await save(session.currentDraft)
  return withStatus(session, 'accepted')
}

export function cancelSkillBuildSession(session: SkillBuildSession): SkillBuildSession {
  return withStatus(session, 'cancelled')
}

export function createRepairableSessionFromArtifact(input: {
  mode: SkillBuildMode
  userRequest: string
  rawArtifact: string
  baseSkillId?: string
  maxRepairRounds?: number
}): SkillBuildSession {
  const parsed = tryParseSkillArtifact(input.rawArtifact)
  const currentDraft = parsed.artifact ?? null
  return createSkillBuildSession({
    mode: input.mode,
    userRequest: input.userRequest,
    baseSkillId: input.baseSkillId,
    currentDraft,
    maxRepairRounds: input.maxRepairRounds,
  })
}
