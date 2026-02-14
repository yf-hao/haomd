import { createContext } from 'react'

export type AiChatCommandBridge = {
  /** 运行一个应用级命令（如 ai_conversation_clear / compress / history） */
  runAppCommand: (id: string) => Promise<void>
}

export const AiChatCommandBridgeContext = createContext<AiChatCommandBridge | null>(null)
