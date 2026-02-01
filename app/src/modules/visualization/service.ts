import { invoke } from '@tauri-apps/api/core'
import { backendLimits, enabledRenderers } from '../../config/renderers'

type Renderer = 'plantuml' | 'xmind'
const enabledMap: Record<Renderer, boolean> = {
  plantuml: enabledRenderers.plantuml,
  xmind: enabledRenderers.xmind,
}

type RenderPayload = {
  data: string
  trace_id?: string
  format?: 'svg' | 'png'
}

type RenderError = {
  code: string
  message: string
  traceId?: string
}

type RenderResult =
  | { ok: true; data: string; format: 'svg' | 'png'; traceId: string; renderer: Renderer }
  | { ok: false; error: RenderError; renderer: Renderer }

const isTauri = () =>
  typeof window !== 'undefined' &&
  (Boolean((window as any).__TAURI_INTERNALS__) || Boolean((window as any).__TAURI__))

const makeTraceId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `trace_${Date.now()}_${Math.random().toString(16).slice(2)}`

const normalizeError = (err: unknown, renderer: Renderer, traceId?: string): RenderResult => {
  const obj = err as Record<string, unknown> | null
  const explicitMsg =
    obj && typeof obj.message === 'string'
      ? obj.message
      : err instanceof Error
        ? err.message
        : undefined
  const message = explicitMsg || String(err) || '渲染失败'
  const code = obj && typeof obj.code === 'string' ? obj.code : 'RENDER_FAILED'
  const trace = obj && typeof obj.trace_id === 'string' ? obj.trace_id : traceId
  return { ok: false, error: { code, message, traceId: trace }, renderer }
}

async function callRenderer(command: string, payload: Record<string, unknown>, renderer: Renderer): Promise<RenderResult> {
  const traceId = (payload.trace_id as string | undefined) ?? makeTraceId()

  if (!enabledMap[renderer]) {
    return {
      ok: false,
      error: { code: 'DISABLED', message: `${renderer} 已禁用`, traceId },
      renderer,
    }
  }

  if (!isTauri()) {
    return {
      ok: false,
      error: { code: 'TAURI_UNAVAILABLE', message: 'Tauri 后端未启动，无法离线渲染', traceId },
      renderer,
    }
  }

  try {
    const response = await invoke<RenderPayload>(command, { ...payload, trace_id: traceId })
    return {
      ok: true,
      data: response.data,
      format: response.format ?? 'svg',
      traceId: response.trace_id ?? traceId,
      renderer,
    }
  } catch (error) {
    return normalizeError(error, renderer, traceId)
  }
}

export async function renderPlantUML(code: string): Promise<RenderResult> {
  return callRenderer(
    'render_plantuml',
    {
      puml: code,
      limits: backendLimits.plantuml,
    },
    'plantuml',
  )
}

export async function renderXMind(input: string): Promise<RenderResult> {
  return callRenderer(
    'render_xmind',
    {
      input,
      limits: backendLimits.xmind,
    },
    'xmind',
  )
}
