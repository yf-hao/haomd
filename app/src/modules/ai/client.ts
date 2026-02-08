import type { DefaultChatConfig } from './settings'
import { loadDefaultChatConfig } from './settings'
import type { AiResponse, IAiClient } from './domain/types'
export type { AiResponse, IAiClient } from './domain/types'

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
    try {
      const cfg = await loadDefaultChatConfig()
      if (!cfg) {
        console.warn('[AI] loadDefaultChatConfig returned null')
        return {
          ok: false,
          message: notConfiguredMessage,
          config: null,
        }
      }
      console.log('[AI] default chat config', cfg)
      return {
        ok: true,
        message: formatMessage(cfg),
        config: cfg,
      }
    } catch (err) {
      console.error('[AI] loadDefaultChatConfig error', err)
      return {
        ok: false,
        message: notConfiguredMessage,
        config: null,
      }
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
