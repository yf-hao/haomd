import { invoke } from '@tauri-apps/api/core'
import { backendLimits, enabledRenderers } from '../../config/renderers'
import { isTauriEnv } from '../platform/runtime'

const isTauri = isTauriEnv

const makeTraceId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `trace_${Date.now()}_${Math.random().toString(16).slice(2)}`

const normalizeError = (err: unknown, traceId?: string) => {
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
  return { ok: false, error: { code, message, traceId: trace }, renderer: 'mind' } as const
}

export async function renderXMind(input: string): Promise<
  | { ok: true; data: string; format: 'svg' | 'png'; traceId: string; renderer: 'mind' }
  | { ok: false; error: { code: string; message: string; traceId?: string }; renderer: 'mind' }
> {
  const traceId = makeTraceId()

  if (!enabledRenderers.mind) {
    return {
      ok: false,
      error: { code: 'DISABLED', message: 'mind 已禁用', traceId },
      renderer: 'mind',
    }
  }

  if (!isTauri()) {
    return {
      ok: false,
      error: { code: 'TAURI_UNAVAILABLE', message: 'Tauri 后端未启动，无法离线渲染', traceId },
      renderer: 'mind',
    }
  }

  try {
    const response = await invoke<{ data: string; format?: 'svg' | 'png'; trace_id?: string }>(
      'render_xmind',
      { input, limits: backendLimits.mind, trace_id: traceId },
    )
    return {
      ok: true,
      data: response.data,
      format: response.format ?? 'svg',
      traceId: response.trace_id ?? traceId,
      renderer: 'mind',
    }
  } catch (error) {
    return normalizeError(error, traceId)
  }
}
