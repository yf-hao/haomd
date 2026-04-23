import {
  parseWordTemplateArtifact,
  parsedWordTemplateArtifactToDraft,
  tryParseWordTemplateArtifact,
} from './templateArtifactParser'
import { validateWordTemplateDraft } from './templateValidationService'
import type {
  WordTemplateBuildMode,
  WordTemplateBuildSession,
  WordTemplateDraft,
  WordTemplateValidationResult,
} from './types'

type RunContext = {
  session: WordTemplateBuildSession
}

type BuildSessionHandlers = {
  generate: (context: RunContext) => Promise<string>
  repair: (context: RunContext) => Promise<string>
}

type ApplyDraftResult = {
  session: WordTemplateBuildSession
  validation: WordTemplateValidationResult
}

function createSessionId(): string {
  return `word-template-build-${Date.now()}`
}

export function createWordTemplateBuildSession(input: {
  mode: WordTemplateBuildMode
  userRequest: string
  baseTemplateId?: string
  currentDraft?: WordTemplateDraft | null
  maxRepairRounds?: number
}): WordTemplateBuildSession {
  return {
    id: createSessionId(),
    mode: input.mode,
    baseTemplateId: input.baseTemplateId,
    userRequest: input.userRequest,
    currentDraft: input.currentDraft ?? null,
    status: 'idle',
    repairCount: 0,
    maxRepairRounds: input.maxRepairRounds ?? 3,
    validationErrors: [],
  }
}

function withStatus(
  session: WordTemplateBuildSession,
  status: WordTemplateBuildSession['status'],
  extra?: Partial<WordTemplateBuildSession>,
): WordTemplateBuildSession {
  return {
    ...session,
    ...extra,
    status,
  }
}

export function applyRawWordTemplateBuildOutput(
  session: WordTemplateBuildSession,
  rawOutput: string,
): ApplyDraftResult {
  const parsed = tryParseWordTemplateArtifact(rawOutput)
  if (!parsed.draft) {
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

  const validation = validateWordTemplateDraft(parsed.draft)
  if (validation.ok) {
    return {
      session: withStatus(session, 'validated', {
        currentDraft: parsed.draft,
        validationErrors: [],
        failureReason: undefined,
      }),
      validation,
    }
  }

  if (session.repairCount >= session.maxRepairRounds) {
    return {
      session: withStatus(session, 'failed', {
        currentDraft: parsed.draft,
        validationErrors: validation.errors,
        failureReason: 'validation_failed_after_retries',
      }),
      validation,
    }
  }

  return {
    session: withStatus(session, 'repairing', {
      currentDraft: parsed.draft,
      validationErrors: validation.errors,
      failureReason: undefined,
    }),
    validation,
  }
}

export async function runWordTemplateBuildSession(
  initialSession: WordTemplateBuildSession,
  handlers: BuildSessionHandlers,
): Promise<WordTemplateBuildSession> {
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
    const applied = applyRawWordTemplateBuildOutput(session, rawOutput)
    session = applied.session

    if (session.status === 'validated' || session.status === 'failed') {
      return session
    }

    session = withStatus(session, 'repairing', {
      repairCount: session.repairCount + 1,
    })
  }
}

export async function acceptWordTemplateBuildSession(
  session: WordTemplateBuildSession,
  accept: (draft: WordTemplateDraft) => Promise<unknown> = async () => {},
): Promise<WordTemplateBuildSession> {
  if (session.status !== 'validated' || !session.currentDraft) {
    throw new Error('Only validated sessions can be accepted')
  }

  await accept(session.currentDraft)
  return withStatus(session, 'accepted')
}

export function cancelWordTemplateBuildSession(
  session: WordTemplateBuildSession,
): WordTemplateBuildSession {
  return withStatus(session, 'cancelled')
}

export function createRepairableWordTemplateSessionFromDraft(input: {
  mode: WordTemplateBuildMode
  userRequest: string
  rawDraft: string
  baseTemplateId?: string
  maxRepairRounds?: number
}): WordTemplateBuildSession {
  const parsed = tryParseWordTemplateArtifact(input.rawDraft)
  const currentDraft = parsed.draft ?? null
  return createWordTemplateBuildSession({
    mode: input.mode,
    userRequest: input.userRequest,
    baseTemplateId: input.baseTemplateId,
    currentDraft,
    maxRepairRounds: input.maxRepairRounds,
  })
}

export function draftToRawWordTemplateArtifact(draft: WordTemplateDraft): string {
  return JSON.stringify(
    {
      templateId: draft.templateId,
      templateName: draft.templateName,
      templateJson: draft.templateJson,
      usageMarkdown: draft.usageMarkdown,
      sampleMarkdown: draft.sampleMarkdown,
    },
    null,
    2,
  )
}

export function parseRawWordTemplateArtifactToDraft(raw: string): WordTemplateDraft {
  return parsedWordTemplateArtifactToDraft(parseWordTemplateArtifact(raw))
}
