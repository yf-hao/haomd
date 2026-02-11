import type { VisionTask, StreamingChatResult } from '../domain/types'

export type StreamingHandlers = {
  onChunk?: (chunk: { content?: string }) => void
  onComplete?: (content: string, tokenCount: number) => void
  onError?: (error: Error) => void
}

/**
 * 通用 Vision 客户端接口：
 * - 输入为领域层抽象的 VisionTask（prompt + images）
 * - 输出/回调复用现有流式聊天的结果与 handlers 结构
 */
export interface IVisionClient {
  ask(
    task: VisionTask,
    handlers: StreamingHandlers,
    options?: { signal?: AbortSignal },
  ): Promise<StreamingChatResult>
}
