import { invoke } from '@tauri-apps/api/core'

export type HttpRequestArgs = {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'
  headers?: Record<string, string>
  body?: unknown
  form?: Record<string, string | number | boolean>
}

export type HttpResponse = {
  ok: boolean
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  cookies?: {
    sent: boolean
    receivedCount: number
    availableForUrl: boolean
  }
}

export async function requestHttp(args: HttpRequestArgs): Promise<HttpResponse> {
  return invoke<HttpResponse>('ai_http_request', { request: args })
}
