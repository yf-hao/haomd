export const filesConfig = {
  historyDirName: 'history',
  maxSnapshots: 50,
  maxSnapshotBytes: 200 * 1024 * 1024, // 200MB
  maxFileBytes: 20 * 1024 * 1024, // 20MB
  autoSave: {
    enabled: true,
    debounceMs: 800,
    idleMs: 1500,
  },
  conflict: {
    statThresholdMs: 500, // mtime 变化敏感度
    hashOnSave: true,
  },
  logging: {
    fields: [
      'timestamp',
      'level',
      'action',
      'file',
      'outcome',
      'code',
      'message',
      'trace_id',
    ] as const,
  },
}
