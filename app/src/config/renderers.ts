export const enabledRenderers = {
  mermaid: true,
  xmind: true,
  katex: true,
}

export const mermaidConfig = {
  startOnLoad: false,
  securityLevel: 'strict' as const,
  theme: 'dark' as const,
  fontFamily: "Inter, 'SF Pro Text', system-ui, -apple-system, sans-serif",
}

export const backendLimits = {
  xmind: {
    command: 'xmind-render',
    timeoutMs: 10_000,
    maxFileMB: 5,
    allowedTypes: ['.xmind', '.json'],
    maxConcurrent: 2,
    queueSize: 20,
    queueStrategy: 'drop_tail' as const,
    maxRetries: 2,
    retryBackoffMs: 500,
  },
}

export const logFields = [
  'timestamp',
  'level',
  'renderer',
  'action',
  'duration_ms',
  'outcome',
  'code',
  'message',
  'trace_id',
] as const
