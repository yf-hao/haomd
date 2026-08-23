import { listen } from '@tauri-apps/api/event'
import { safeUnlisten } from './safeUnlisten'

export type Unlisten = () => void

export type WebDavImportFinishedPayload = {
  success: boolean
  message?: string | null
}

export type WebDavImportProgressPayload = {
  phase: 'scanning' | 'comparing' | 'downloading'
  current: number
  total: number
  path: string
  size: number
  skippedCount: number
}

export type WebDavExportFinishedPayload = {
  success: boolean
  message?: string | null
  noUploads?: boolean
  summary?: {
    totalFiles: number
    uploadedFiles: number
    skippedFiles: number
    deletedFiles: number
    incremental: boolean
  } | null
}

export type WebDavExportProgressPayload = {
  phase: 'scanning' | 'uploading'
  current: number
  total: number
  path: string
  size: number
  fileCount: number
  dirCount: number
}

export function onWebDavImportStarted(handler: () => void): Unlisten {
  let unlisten: Unlisten | undefined
  let disposed = false
  let unlistenCalled = false

  const setup = async () => {
    try {
      const un = await listen('backup://webdav_import_started', () => {
        handler()
      })
      if (disposed) {
        if (!unlistenCalled) {
          unlistenCalled = true
          safeUnlisten(un, 'backupEvents:backup://webdav_import_started')
        }
      } else {
        unlisten = un
      }
    } catch (err) {
      console.error('[backupEvents] listen backup://webdav_import_started failed', err)
    }
  }

  void setup()

  return () => {
    disposed = true
    if (unlisten && !unlistenCalled) {
      unlistenCalled = true
      safeUnlisten(unlisten, 'backupEvents:backup://webdav_import_started')
    }
  }
}

export function onWebDavImportFinished(
  handler: (payload: WebDavImportFinishedPayload) => void,
): Unlisten {
  let unlisten: Unlisten | undefined
  let disposed = false
  let unlistenCalled = false

  const setup = async () => {
    try {
      const un = await listen<WebDavImportFinishedPayload>(
        'backup://webdav_import_finished',
        (event) => {
          handler(event.payload)
        },
      )
      if (disposed) {
        if (!unlistenCalled) {
          unlistenCalled = true
          safeUnlisten(un, 'backupEvents:backup://webdav_import_finished')
        }
      } else {
        unlisten = un
      }
    } catch (err) {
      console.error('[backupEvents] listen backup://webdav_import_finished failed', err)
    }
  }

  void setup()

  return () => {
    disposed = true
    if (unlisten && !unlistenCalled) {
      unlistenCalled = true
      safeUnlisten(unlisten, 'backupEvents:backup://webdav_import_finished')
    }
  }
}

export function onWebDavImportProgress(
  handler: (payload: WebDavImportProgressPayload) => void,
): Unlisten {
  let unlisten: Unlisten | undefined
  let disposed = false
  let unlistenCalled = false

  const setup = async () => {
    try {
      const un = await listen<WebDavImportProgressPayload>(
        'backup://webdav_import_progress',
        (event) => {
          handler(event.payload)
        },
      )
      if (disposed) {
        if (!unlistenCalled) {
          unlistenCalled = true
          safeUnlisten(un, 'backupEvents:backup://webdav_import_progress')
        }
      } else {
        unlisten = un
      }
    } catch (err) {
      console.error('[backupEvents] listen backup://webdav_import_progress failed', err)
    }
  }

  void setup()

  return () => {
    disposed = true
    if (unlisten && !unlistenCalled) {
      unlistenCalled = true
      safeUnlisten(unlisten, 'backupEvents:backup://webdav_import_progress')
    }
  }
}

export function onWebDavExportStarted(handler: () => void): Unlisten {
  let unlisten: Unlisten | undefined
  let disposed = false
  let unlistenCalled = false

  const setup = async () => {
    try {
      const un = await listen('backup://webdav_export_started', () => {
        handler()
      })
      if (disposed) {
        if (!unlistenCalled) {
          unlistenCalled = true
          safeUnlisten(un, 'backupEvents:backup://webdav_export_started')
        }
      } else {
        unlisten = un
      }
    } catch (err) {
      console.error('[backupEvents] listen backup://webdav_export_started failed', err)
    }
  }

  void setup()

  return () => {
    disposed = true
    if (unlisten && !unlistenCalled) {
      unlistenCalled = true
      safeUnlisten(unlisten, 'backupEvents:backup://webdav_export_started')
    }
  }
}

export function onWebDavExportProgress(
  handler: (payload: WebDavExportProgressPayload) => void,
): Unlisten {
  let unlisten: Unlisten | undefined
  let disposed = false
  let unlistenCalled = false

  const setup = async () => {
    try {
      const un = await listen<WebDavExportProgressPayload>(
        'backup://webdav_export_progress',
        (event) => {
          handler(event.payload)
        },
      )
      if (disposed) {
        if (!unlistenCalled) {
          unlistenCalled = true
          safeUnlisten(un, 'backupEvents:backup://webdav_export_progress')
        }
      } else {
        unlisten = un
      }
    } catch (err) {
      console.error('[backupEvents] listen backup://webdav_export_progress failed', err)
    }
  }

  void setup()

  return () => {
    disposed = true
    if (unlisten && !unlistenCalled) {
      unlistenCalled = true
      safeUnlisten(unlisten, 'backupEvents:backup://webdav_export_progress')
    }
  }
}

export function onWebDavExportFinished(
  handler: (payload: WebDavExportFinishedPayload) => void,
): Unlisten {
  let unlisten: Unlisten | undefined
  let disposed = false
  let unlistenCalled = false

  const setup = async () => {
    try {
      const un = await listen<WebDavExportFinishedPayload>(
        'backup://webdav_export_finished',
        (event) => {
          handler(event.payload)
        },
      )
      if (disposed) {
        if (!unlistenCalled) {
          unlistenCalled = true
          safeUnlisten(un, 'backupEvents:backup://webdav_export_finished')
        }
      } else {
        unlisten = un
      }
    } catch (err) {
      console.error('[backupEvents] listen backup://webdav_export_finished failed', err)
    }
  }

  void setup()

  return () => {
    disposed = true
    if (unlisten && !unlistenCalled) {
      unlistenCalled = true
      safeUnlisten(unlisten, 'backupEvents:backup://webdav_export_finished')
    }
  }
}
