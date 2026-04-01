import type { UiProvider } from '../settings'

export type ResolveConversationIdContext = {
  provider: UiProvider
  initialDifyConversationId?: string
  difyProviderConversations: Record<string, string>
}

interface DifyConversationResolver {
  supports(provider: UiProvider): boolean
  resolve(context: ResolveConversationIdContext): string | undefined
}

class AgentDifyConversationResolver implements DifyConversationResolver {
  supports(provider: UiProvider): boolean {
    return provider.id.startsWith('agent:')
  }

  resolve(context: ResolveConversationIdContext): string | undefined {
    return context.difyProviderConversations[context.provider.id]
  }
}

class DefaultDifyConversationResolver implements DifyConversationResolver {
  supports(): boolean {
    return true
  }

  resolve(context: ResolveConversationIdContext): string | undefined {
    return (
      context.difyProviderConversations[context.provider.id] ??
      context.initialDifyConversationId
    )
  }
}

const resolvers: DifyConversationResolver[] = [
  new AgentDifyConversationResolver(),
  new DefaultDifyConversationResolver(),
]

export function resolveDifyConversationId(
  context: ResolveConversationIdContext,
): string | undefined {
  const resolver = resolvers.find((item) => item.supports(context.provider))
  return resolver?.resolve(context)
}
