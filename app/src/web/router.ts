export type WebLiteRoute =
  | { name: 'chat'; sessionId?: string }
  | { name: 'notes'; noteId?: string }
  | { name: 'settings' }

function parseHash(hash: string): WebLiteRoute {
  const normalized = hash.replace(/^#/, '').replace(/^\/+/, '')
  const parts = normalized.split('/').filter(Boolean)
  const [root, id] = parts

  if (root === 'notes') return { name: 'notes', noteId: id }
  if (root === 'settings') return { name: 'settings' }
  return { name: 'chat', sessionId: id }
}

export function getCurrentRoute(): WebLiteRoute {
  if (typeof window === 'undefined') return { name: 'chat' }
  return parseHash(window.location.hash)
}

export function navigateTo(route: WebLiteRoute): void {
  if (typeof window === 'undefined') return
  let hash = '#/chat'
  if (route.name === 'notes') {
    hash = route.noteId ? `#/notes/${route.noteId}` : '#/notes'
  } else if (route.name === 'settings') {
    hash = '#/settings'
  } else if (route.sessionId) {
    hash = `#/chat/${route.sessionId}`
  }

  if (window.location.hash === hash) return
  window.location.hash = hash
}
