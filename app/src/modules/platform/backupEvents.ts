import { listen } from '@tauri-apps/api/event'

export type Unlisten = () => void

export type WebDavImportFinishedPayload = {
  success: boolean
  message?: string | null
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
          try {
            un()
          } catch (err) {
            console.warn('[backupEvents] unlisten backup://webdav_import_finished failed', err)
          }
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
      try {
        unlisten()
      } catch (err) {
        console.warn('[backupEvents] manual unlisten backup://webdav_import_finished failed', err)
      }
    }
  }
}
