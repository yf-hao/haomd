import { createContext } from 'react'

export type AiChatCommandBridge = {
  /** 运行一个应用级命令（如 ai_conversation_clear / compress / history） */
  runAppCommand: (id: string) => Promise<void>
  /** 清空 AI Chat 当前绑定的会话，按会话类型清除对应持久化记录 */
  clearCurrentConversation?: () => Promise<void>
}

export const AiChatCommandBridgeContext = createContext<AiChatCommandBridge | null>(null)
