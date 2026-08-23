type Unlisten = (() => void) | (() => Promise<void>)

function isMissingTauriListenerError(error: unknown): boolean {
  return String(error).includes('listeners[eventId].handlerId')
}

/**
 * Tauri's unlisten function is asynchronous even though its type is commonly
 * used as a synchronous React effect cleanup. Cleanup races during StrictMode,
 * reloads, or webview teardown can therefore reject after the cleanup returns.
 */
export function safeUnlisten(unlisten: Unlisten | undefined, label: string): void {
  if (!unlisten) return

  try {
    void Promise.resolve(unlisten()).catch((error) => {
      if (isMissingTauriListenerError(error)) return
      console.warn(`[${label}] unlisten failed`, error)
    })
  } catch (error) {
    console.warn(`[${label}] unlisten failed`, error)
  }
}
