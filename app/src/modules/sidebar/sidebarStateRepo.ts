import { invoke } from '@tauri-apps/api/core'

export type SidebarState = {
  root: string | null
  expandedPaths: string[]
  standaloneFiles: string[]
  folderRoots: string[]
}

type BackendSidebarState = {
  root: string | null
  expanded_paths: string[]
  standalone_files: string[]
  folder_roots: string[]
}

type BackendCode =
  | 'OK'
  | 'CANCELLED'
  | 'IoError'
  | 'NotFound'
  | 'TooLarge'
  | 'CONFLICT'
  | 'InvalidPath'
  | 'UNSUPPORTED'
  | 'UNKNOWN'

type BackendError = { code: BackendCode; message: string; trace_id?: string }

type BackendOk<T> = { data: T; trace_id?: string }

type BackendResult<T> = { Ok: BackendOk<T> } | { Err: { error: BackendError } }

const isTauri = () =>
  typeof window !== 'undefined' &&
  (Boolean((window as any).__TAURI_INTERNALS__) || Boolean((window as any).__TAURI__))

const makeTraceId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `trace_${Date.now()}_${Math.random().toString(16).slice(2)}`

const DEFAULT_STATE: SidebarState = {
  root: null,
  expandedPaths: [],
  standaloneFiles: [],
  folderRoots: [],
}

const toFrontendState = (backend: BackendSidebarState): SidebarState => ({
  root: backend.root ?? null,
  expandedPaths: backend.expanded_paths ?? [],
  standaloneFiles: backend.standalone_files ?? [],
  folderRoots: backend.folder_roots ?? [],
})

export async function loadSidebarState(): Promise<SidebarState> {
  const traceId = makeTraceId()
  if (!isTauri()) return DEFAULT_STATE

  try {
    const resp = await invoke<BackendResult<BackendSidebarState>>('load_sidebar_state', {
      trace_id: traceId,
    })

    if ('Ok' in resp) {
      return toFrontendState(resp.Ok.data)
    }

    console.warn('[sidebarStateRepo] load_sidebar_state error', resp.Err.error)
    return DEFAULT_STATE
  } catch (error) {
    console.warn('[sidebarStateRepo] load_sidebar_state invoke failed', error)
    return DEFAULT_STATE
  }
}

export async function saveSidebarState(state: SidebarState): Promise<void> {
  const traceId = makeTraceId()
  if (!isTauri()) return

  const backendState: BackendSidebarState = {
    root: state.root,
    expanded_paths: state.expandedPaths,
    standalone_files: state.standaloneFiles,
    folder_roots: state.folderRoots,
  }

  try {
    const resp = await invoke<BackendResult<unknown>>('save_sidebar_state', {
      state: backendState,
      trace_id: traceId,
    })

    if ('Err' in resp) {
      console.warn('[sidebarStateRepo] save_sidebar_state error', resp.Err.error)
    }
  } catch (error) {
    console.warn('[sidebarStateRepo] save_sidebar_state invoke failed', error)
  }
}
