import type { VisionTask, IStreamingChatClient, StreamingChatRequest } from '../domain/types'
import type { IImageUrlResolver } from '../../images/imageUrlResolver'
import type { IVisionClient, StreamingHandlers } from '../vision/visionClient'

function buildModelScopeMessages(task: VisionTask, imageUrls: string[]): any[] {
  // 当前先支持单图，多图可按 ModelScope 文档扩展
  const [firstUrl] = imageUrls

  return [
    {
      role: 'user',
      // 这里引入 ModelScope/OpenAI image_url 协议细节
      content: [
        { type: 'image_url', image_url: { url: firstUrl } },
        { type: 'text', text: task.prompt },
      ],
    } as any,
  ]
}

/**
 * ModelScope 视觉客户端适配器：
 * - 使用现有 IStreamingChatClient 作为底层流式通道
 * - 将 VisionTask 翻译为 ModelScope 期望的 messages 结构
 */
export class ModelScopeVisionClient implements IVisionClient {
  private readonly chatClient: IStreamingChatClient
  private readonly imageUrlResolver: IImageUrlResolver

  constructor(chatClient: IStreamingChatClient, imageUrlResolver: IImageUrlResolver) {
    this.chatClient = chatClient
    this.imageUrlResolver = imageUrlResolver
  }

  async ask(task: VisionTask, handlers: StreamingHandlers, options?: { signal?: AbortSignal }) {
    const imageUrls = await Promise.all(
      task.images.map((img) => this.imageUrlResolver.resolve(img)),
    )

    const messages = buildModelScopeMessages(task, imageUrls)
    const request: StreamingChatRequest = {
      messages,
      temperature: 0,
      maxTokens: 512,
      signal: options?.signal,
    }

    return this.chatClient.askStream(request, handlers)
  }
}
