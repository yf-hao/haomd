import type { DefaultChatConfig } from './settings'
import { loadDefaultChatConfig } from './settings'

export type AiResponse = {
  ok: boolean
  message: string
  config?: DefaultChatConfig | null
}

/**
 * 抽象的 AI 客户端接口，命令系统只依赖这个接口而不关心具体实现。
 */
export interface IAiClient {
  /**
   * 打开通用对话入口，例如“AI Chat”。
   */
  openChat(): Promise<AiResponse>

  /**
   * 针对当前文件发起提问。
   * 未来可以根据文件路径或内容扩展参数。
   */
  askAboutFile(): Promise<AiResponse>

  /**
   * 针对当前选中内容发起提问。
   * 未来可以携带选中的文本等信息。
   */
  askAboutSelection(): Promise<AiResponse>
}

/**
 * 默认的 AI 客户端实现：
 * - 基于当前 AI Settings 中的默认 Provider + 默认 Model；
 * - 暂时只返回提示信息，后续可以在这里接入真实的对话后端。
 */
export function createDefaultAiClient(): IAiClient {
  async function ensureConfig(
    notConfiguredMessage: string,
    formatMessage: (cfg: DefaultChatConfig) => string,
  ): Promise<AiResponse> {
    const cfg = await loadDefaultChatConfig()
    if (!cfg) {
      return {
        ok: false,
        message: notConfiguredMessage,
        config: null,
      }
    }
    return {
      ok: true,
      message: formatMessage(cfg),
      config: cfg,
    }
  }

  return {
    async openChat() {
      return ensureConfig(
        'AI Chat 未配置：请先在 AI Settings 中设置默认 Provider/Model',
        (cfg) => `AI Chat 将使用默认模型：${cfg.model}`,
      )
    },

    async askAboutFile() {
      return ensureConfig(
        'Ask AI About File 未配置：请先在 AI Settings 中设置默认 Provider/Model',
        (cfg) => `Ask AI About File 将使用默认模型：${cfg.model}`,
      )
    },

    async askAboutSelection() {
      return ensureConfig(
        'Ask AI About Selection 未配置：请先在 AI Settings 中设置默认 Provider/Model',
        (cfg) => `Ask AI About Selection 将使用默认模型：${cfg.model}`,
      )
    },
  }
}
