import { createStore } from 'idb-keyval'

export const webLiteStore = createStore('haomd-web-lite', 'app')

export const DB_KEYS = {
  chatSessions: 'web-lite:chat-sessions',
  notes: 'web-lite:notes',
  settings: 'web-lite:settings',
} as const
