// src/web/app.ts
// Web 前端主逻辑

import { SimpleChat, MessageRole } from './simple-chat'
import { ChatConfig, StreamConfig } from './simple-chat'

/**
 * Web 聊天应用主类
 */
class WebChatApp {
  private chat: SimpleChat | null = null
  private config: ChatConfig | null = null

  constructor() {
    this.init()
  }

  private init() {
    // 加载配置
    this.loadConfig()

    // 初始化 SimpleChat 实例
    if (this.config) {
      this.chat = new SimpleChat()
      this.chat.init(this.config)
    }

    // 绑定 UI 事件
    this.bindEvents()
  }

  private loadConfig() {
    const saved = localStorage.getItem('haode_config')
    if (saved) {
      this.config = JSON.parse(saved)
      this.populateConfigForm()
    }
  }

  private saveConfig() {
    const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement
    const baseUrlInput = document.getElementById('baseUrl') as HTMLInputElement
    const modelInput = document.getElementById('model') as HTMLInputElement
    const systemPromptInput = document.getElementById('systemPrompt') as HTMLTextAreaElement

    const config: ChatConfig = {
      apiKey: apiKeyInput?.value || '',
      baseURL: baseUrlInput?.value || '',
      model: modelInput?.value || '',
      temperature: 0.7,
      maxTokens: 2000,
      systemPrompt: systemPromptInput?.value || ''
    }

    this.config = config
    localStorage.setItem('haode_config', JSON.stringify(config))

    // 重新创建 SimpleChat 实例
    this.chat = new SimpleChat()
    this.chat.init(config)

    alert('配置已保存')
  }

  private populateConfigForm() {
    if (!this.config) return

    const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement
    const baseUrlInput = document.getElementById('baseUrl') as HTMLInputElement
    const modelInput = document.getElementById('model') as HTMLInputElement
    const systemPromptInput = document.getElementById('systemPrompt') as HTMLTextAreaElement

    if (apiKeyInput) apiKeyInput.value = this.config.apiKey || ''
    if (baseUrlInput) baseUrlInput.value = this.config.baseURL || ''
    if (modelInput) modelInput.value = this.config.model || ''
    if (systemPromptInput) systemPromptInput.value = this.config.systemPrompt || ''
  }

  private async sendMessage() {
    if (!this.chat) {
      alert('请先配置 API')
      return
    }

    const input = document.getElementById('userInput') as HTMLInputElement
    const message = input.value.trim()
    if (!message) return

    // 显示用户消息
    this.addMessage('user', message)
    input.value = ''

    // 准备流式配置
    const streamConfig: StreamConfig = {
      enabled: true,
      onChunk: (chunk) => {
        if (chunk.content) {
          this.appendMessage(chunk.content)
        }
      },
      onComplete: (content, tokenCount) => {
        console.log(`完成，Token 使用: ${tokenCount}`)
      },
      onError: (error) => {
        console.error('流式错误:', error)
      }
    }

    // 发送流式消息
    try {
      const result = await this.chat.askStream(
        {
          messages: [{ role: MessageRole.User, content: message }]
        },
        streamConfig
      )

      if (result.error) {
        throw result.error
      }
    } catch (err: any) {
      console.error('发送消息失败:', err)
      this.addMessage('assistant', `❌ 错误: ${err.message || '发送失败，请检查配置'}`)
    }
  }

  private addMessage(role: 'user' | 'assistant', content: string) {
    const messagesDiv = document.getElementById('chatMessages')
    if (!messagesDiv) return

    const messageDiv = document.createElement('div')
    messageDiv.className = `message ${role}`
    messageDiv.textContent = content
    messagesDiv.appendChild(messageDiv)
    this.scrollToBottom()
    return messageDiv
  }

  private appendMessage(content: string) {
    const messagesDiv = document.getElementById('chatMessages')
    if (!messagesDiv) return

    const lastMessage = messagesDiv.querySelector('.message.assistant:last-child')

    if (!lastMessage || lastMessage.textContent?.includes('❌')) {
      this.addMessage('assistant', '')
    }

    const assistantMessage = messagesDiv.querySelector('.message.assistant:last-child')
    if (assistantMessage) {
      assistantMessage.textContent += content
    }

    this.scrollToBottom()
  }

  private scrollToBottom() {
    const messagesDiv = document.getElementById('chatMessages')
    if (messagesDiv) {
      messagesDiv.scrollTop = messagesDiv.scrollHeight
    }
  }

  private clearHistory() {
    this.chat?.clearHistory()
    const messagesDiv = document.getElementById('chatMessages')
    if (messagesDiv) {
      messagesDiv.innerHTML = `
        <div class="message assistant">
          对话历史已清除
        </div>
      `
    }
  }

  private bindEvents() {
    const sendBtn = document.getElementById('sendBtn')
    const saveBtn = document.getElementById('saveConfig')
    const clearBtn = document.getElementById('clearHistory')
    const userInput = document.getElementById('userInput')

    sendBtn?.addEventListener('click', () => this.sendMessage())
    saveBtn?.addEventListener('click', () => this.saveConfig())
    clearBtn?.addEventListener('click', () => this.clearHistory())
    userInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendMessage()
    })
  }
}

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
  new WebChatApp()
})
