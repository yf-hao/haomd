# AI Chat 会话管理方案

## 一、背景与现状分析

### 1.1 当前问题

当前实现存在以下问题：

- 每次 `open` 变为 `true` 时，`useAiChat` hook 都会创建新会话
- `open` 变为 `false` 时，会话被 `dispose()` 销毁
- 没有按 tab ID 存储会话的机制
- 无法在不同 tab 间保持独立会话
- 关闭 AI Chat 对话框后，会话历史丢失

### 1.2 用户需求

- 每个 tab 维护独立的 AI Chat 会话
- 在同一个 tab 中多次打开/关闭 AI Chat 对话框，会话保持
- 不同 tab 之间会话独立，互不影响
- 关闭 tab 时清理对应的会话

## 二、总体设计

### 2.1 核心思路

1. **会话持久化**：将会话状态存储到持久化介质（localStorage 或文件系统）
2. **按 tab 管理**：以 `tabId` 作为会话的唯一标识
3. **生命周期管理**：
   - 创建：第一次打开 AI Chat 时创建（按 tabId）
   - 加载：打开 AI Chat 时从存储中恢复
   - 保存：每次消息发送后保存
   - 清理：关闭 tab 时清理

### 2.2 架构图

```
┌─────────────────────────────────────────────────────────┐
│                   WorkspaceShell                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐│
│  │  Tab 1   │  │  Tab 2   │  │  Tab 3   │  │ Tab N   ││
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬────┘│
└───────┼────────────┼────────────┼────────────┼───────┘
        │            │            │            │
        └────────────┴────────────┴────────────┘
                     │
            ┌────────▼────────┐
            │  AiChatDialog   │ (传递 tabId)
            └────────┬────────┘
                     │
            ┌────────▼────────┐
            │  useAiChat Hook │
            └────────┬────────┘
                     │
            ┌────────▼──────────────┐
            │  AiChatSessionManager │ (按 tabId 存储会话)
            └────────┬──────────────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
   ┌────▼────┐  ┌───▼────┐  ┌───▼────┐
   │ Session │  │ Session│  │ Session│ (按 tabId)
   │  Tab 1  │  │  Tab 2 │  │  Tab 3 │
   └────┬────┘  └───┬────┘  └───┬────┘
        └────────────┼────────────┘
                     │
            ┌────────▼────────┐
            │  Storage        │ (localStorage / File)
            └─────────────────┘
```

## 三、详细设计

### 3.1 会话存储结构

```typescript
// app/src/modules/ai/domain/aiChatSessionManager.ts

import type { ConversationState, EntryContext, ChatEntryMode } from './chatSession'
import type { SystemPromptInfo } from '../application/systemPromptService'
import type { ProviderType } from './types'

export type PersistedAiChatSession = {
  tabId: string                        // Tab ID
  state: ConversationState             // 会话状态
  systemPromptInfo: SystemPromptInfo | null  // 系统提示信息
  providerType: ProviderType | null    // AI 提供商类型
  entryMode: ChatEntryMode             // 入口模式
  initialContext?: EntryContext        // 初始上下文
  createdAt: number                    // 创建时间戳
  updatedAt: number                    // 更新时间戳
}

export interface IAiChatSessionManager {
  // 获取或创建会话
  getOrCreateSession(tabId: string): PersistedAiChatSession | null
  
  // 保存会话状态
  saveSession(tabId: string, data: {
    state: ConversationState
    systemPromptInfo: SystemPromptInfo | null
    providerType: ProviderType | null
  }): void
  
  // 删除会话
  deleteSession(tabId: string): void
  
  // 清理所有会话
  clearAllSessions(): void
  
  // 判断会话是否存在
  hasSession(tabId: string): boolean
}
```

### 3.2 会话管理器实现

#### 方案 A：localStorage 实现（推荐初期使用）

**优点**：
- 实现简单，无需后端支持
- 访问速度快
- 适合开发和测试阶段

**缺点**：
- 应用重启后数据丢失（5-10MB 限制）
- 不适合大量会话存储

```typescript
// app/src/modules/ai/application/localStorageAiChatSessionManager.ts

import type { IAiChatSessionManager, PersistedAiChatSession } from '../domain/aiChatSessionManager'

const STORAGE_KEY = 'haomd_ai_chat_sessions'

export class LocalStorageAiChatSessionManager implements IAiChatSessionManager {
  private sessions: Map<string, PersistedAiChatSession>
  
  constructor() {
    this.sessions = this.loadFromStorage()
  }
  
  private loadFromStorage(): Map<string, PersistedAiChatSession> {
    if (typeof window === 'undefined') return new Map()
    try {
      const data = localStorage.getItem(STORAGE_KEY)
      return data ? new Map(JSON.parse(data)) : new Map()
    } catch (e) {
      console.error('Failed to load AI chat sessions from localStorage:', e)
      return new Map()
    }
  }
  
  private saveToStorage() {
    if (typeof window === 'undefined') return
    try {
      const data = Array.from(this.sessions.entries())
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch (e) {
      console.error('Failed to save AI chat sessions to localStorage:', e)
    }
  }
  
  getOrCreateSession(tabId: string): PersistedAiChatSession | null {
    return this.sessions.get(tabId) || null
  }
  
  saveSession(tabId: string, data: {
    state: any
    systemPromptInfo: any
    providerType: any
  }): void {
    const existing = this.sessions.get(tabId)
    const now = Date.now()
    
    const session: PersistedAiChatSession = {
      tabId,
      state: data.state,
      systemPromptInfo: data.systemPromptInfo,
      providerType: data.providerType,
      entryMode: existing?.entryMode ?? 'chat',
      initialContext: existing?.initialContext,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    
    this.sessions.set(tabId, session)
    this.saveToStorage()
  }
  
  deleteSession(tabId: string): void {
    this.sessions.delete(tabId)
    this.saveToStorage()
  }
  
  clearAllSessions(): void {
    this.sessions.clear()
    this.saveToStorage()
  }
  
  hasSession(tabId: string): boolean {
    return this.sessions.has(tabId)
  }
}

// 导出单例
export const aiChatSessionManager = new LocalStorageAiChatSessionManager()
```

#### 方案 B：Tauri 文件系统实现（后期升级）

**优点**：
- 数据持久化，应用重启后保留
- 不受存储空间限制
- 更适合生产环境

**缺点**：
- 实现复杂，需要处理文件 I/O
- 需要 Tauri 环境支持

```typescript
// app/src/modules/ai/application/fileAiChatSessionManager.ts

import { readTextFile, writeTextFile, exists, mkdir } from '@tauri-apps/plugin-fs'
import { join, appDataDir } from '@tauri-apps/api/path'
import type { IAiChatSessionManager, PersistedAiChatSession } from '../domain/aiChatSessionManager'

export class FileAiChatSessionManager implements IAiChatSessionManager {
  private cache: Map<string, PersistedAiChatSession>
  private dataDir: string | null = null
  private initialized = false
  
  constructor() {
    this.cache = new Map()
    this.init()
  }
  
  private async init() {
    if (this.initialized) return
    
    try {
      const appDir = await appDataDir()
      const dataDir = await join(appDir, 'haomd', 'ai-chat-sessions')
      
      if (!(await exists(dataDir))) {
        await mkdir(dataDir, { recursive: true })
      }
      
      this.dataDir = dataDir
      this.initialized = true
    } catch (e) {
      console.error('Failed to initialize file session manager:', e)
    }
  }
  
  private async getFilePath(tabId: string): Promise<string | null> {
    if (!this.dataDir) return null
    return await join(this.dataDir, `${tabId}.json`)
  }
  
  private async loadFromFile(tabId: string): Promise<PersistedAiChatSession | null> {
    const filePath = await this.getFilePath(tabId)
    if (!filePath) return null
    
    try {
      const data = await readTextFile(filePath)
      return JSON.parse(data)
    } catch {
      return null
    }
  }
  
  async getOrCreateSession(tabId: string): Promise<PersistedAiChatSession | null> {
    // 确保已初始化
    if (!this.initialized) await this.init()
    
    // 优先从缓存
    if (this.cache.has(tabId)) {
      return this.cache.get(tabId)!
    }
    
    // 从文件加载
    const session = await this.loadFromFile(tabId)
    if (session) {
      this.cache.set(tabId, session)
    }
    
    return session
  }
  
  async saveSession(tabId: string, data: {
    state: any
    systemPromptInfo: any
    providerType: any
  }): Promise<void> {
    // 确保已初始化
    if (!this.initialized) await this.init()
    
    const existing = await this.getOrCreateSession(tabId)
    const now = Date.now()
    
    const session: PersistedAiChatSession = {
      tabId,
      state: data.state,
      systemPromptInfo: data.systemPromptInfo,
      providerType: data.providerType,
      entryMode: existing?.entryMode ?? 'chat',
      initialContext: existing?.initialContext,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    
    this.cache.set(tabId, session)
    
    const filePath = await this.getFilePath(tabId)
    if (filePath) {
      await writeTextFile(filePath, JSON.stringify(session, null, 2))
    }
  }
  
  async deleteSession(tabId: string): Promise<void> {
    this.cache.delete(tabId)
    // TODO: 删除文件（需要实现文件删除逻辑）
  }
  
  async clearAllSessions(): Promise<void> {
    this.cache.clear()
    // TODO: 清理目录下的所有文件
  }
  
  hasSession(tabId: string): boolean {
    return this.cache.has(tabId)
  }
}
```

### 3.3 修改 chatSessionService

```typescript
// app/src/modules/ai/application/chatSessionService.ts

export type StartChatOptions = {
  entryMode: ChatEntryMode
  initialContext?: EntryContext
  initialState?: ConversationState  // 新增：允许传入初始状态
  onStateChange?: (state: ConversationState) => void
}

export interface ChatSession {
  getState(): ConversationState
  getSystemPromptInfo(): SystemPromptInfo | null
  getProviderType(): ProviderType | null
  sendUserMessage(content: string, options?: { hideInView?: boolean }): Promise<void>
  setActiveRole(roleId: string): Promise<void>
  dispose(): void
}

export async function createChatSession(options: StartChatOptions): Promise<ChatSession> {
  // 如果传入了 initialState，使用它；否则创建新状态
  const initialState = options.initialState ?? createInitialConversationState(
    options.entryMode,
    undefined,  // systemPrompt 会在后续从设置中加载
    options.initialContext,
  )
  
  // 使用 initialState 创建会话
  // ... 原有实现，但使用 initialState 而不是每次都创建新状态
}
```

### 3.4 修改 useAiChat Hook

```typescript
// app/src/modules/ai/ui/hooks/useAiChat.ts

export type UseAiChatOptions = {
  entryMode: ChatEntryMode
  initialContext?: EntryContext
  open: boolean
  tabId: string  // 新增：tab ID
}

export function useAiChat(options: UseAiChatOptions): UseAiChatResult {
  const { entryMode, initialContext, open, tabId } = options
  const [session, setSession] = useState<ChatSession | null>(null)
  const [loading, setLoading] = useState(false)
  const [state, setState] = useState<ConversationState | null>(null)
  const [systemPromptInfo, setSystemPromptInfo] = useState<SystemPromptInfo | null>(null)
  const [providerType, setProviderType] = useState<ProviderType | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    const startSession = async () => {
      try {
        // 1. 尝试从存储恢复会话
        const savedSession = await aiChatSessionManager.getOrCreateSession(tabId)
        
        if (savedSession) {
          // 2. 恢复已保存的会话状态
          setState(savedSession.state)
          setSystemPromptInfo(savedSession.systemPromptInfo)
          setProviderType(savedSession.providerType)
          
          // 3. 创建新的 session 对象，但传入恢复的状态
          const startOptions: StartChatOptions = {
            entryMode: savedSession.entryMode,
            initialContext: savedSession.initialContext,
            initialState: savedSession.state,  // 传入初始状态
            onStateChange: (nextState) => {
              if (cancelled) return
              setState(nextState)
              // 实时保存到存储
              aiChatSessionManager.saveSession(tabId, {
                state: nextState,
                systemPromptInfo: savedSession.systemPromptInfo,
                providerType: savedSession.providerType,
              })
            },
          }
          
          const created = await createChatSession(startOptions)
          if (cancelled) {
            created.dispose()
            return
          }
          
          setSession(created)
        } else {
          // 4. 没有保存的会话，创建新会话
          const startOptions: StartChatOptions = {
            entryMode,
            initialContext,
            onStateChange: (nextState) => {
              if (cancelled) return
              setState(nextState)
              // 实时保存到存储
              if (session) {
                const currentInfo = session.getSystemPromptInfo()
                const currentProvider = session.getProviderType()
                aiChatSessionManager.saveSession(tabId, {
                  state: nextState,
                  systemPromptInfo: currentInfo,
                  providerType: currentProvider,
                })
              }
            },
          }
          
          const created = await createChatSession(startOptions)
          if (cancelled) {
            created.dispose()
            return
          }
          
          setSession(created)
          setState(created.getState())
          setSystemPromptInfo(created.getSystemPromptInfo())
          setProviderType(created.getProviderType())
        }
      } catch (e) {
        if (cancelled) return
        setError(e as Error)
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void startSession()

    return () => {
      cancelled = true
      // 不再 dispose session，保留状态以便下次恢复
      // setSession((prev) => {
      //   if (prev) {
      //     prev.dispose()
      //   }
      //   return null
      // })
    }
  }, [open, entryMode, initialContext, tabId])

  const send = useCallback(
    async (content: string, options?: { hideUserInView?: boolean }) => {
      if (!session) return
      setError(null)
      await session.sendUserMessage(content, { hideInView: options?.hideUserInView })
      const nextState = session.getState()
      setState(nextState)
      setSystemPromptInfo(session.getSystemPromptInfo())
      
      // 保存到存储
      await aiChatSessionManager.saveSession(tabId, {
        state: nextState,
        systemPromptInfo: session.getSystemPromptInfo(),
        providerType: session.getProviderType(),
      })
    },
    [session, tabId],
  )

  const changeRole = useCallback(
    async (roleId: string) => {
      if (!session) return
      setError(null)
      await session.setActiveRole(roleId)
      const newInfo = session.getSystemPromptInfo()
      setSystemPromptInfo(newInfo)
      
      // 保存到存储
      await aiChatSessionManager.saveSession(tabId, {
        state: session.getState(),
        systemPromptInfo: newInfo,
        providerType: session.getProviderType(),
      })
    },
    [session, tabId],
  )

  const resetError = useCallback(() => {
    setError(null)
  }, [])

  return {
    loading,
    state,
    systemPromptInfo,
    providerType,
    error,
    send,
    changeRole,
    resetError,
  }
}
```

### 3.5 修改 AiChatDialog

```typescript
// app/src/modules/ai/ui/AiChatDialog.tsx

export type AiChatDialogProps = {
  open: boolean
  entryMode: ChatEntryMode
  initialContext?: EntryContext
  onClose: () => void
  tabId: string  // 新增：tab ID
}

export const AiChatDialog: FC<AiChatDialogProps> = ({ 
  open, 
  entryMode, 
  initialContext, 
  onClose,
  tabId
}) => {
  const { loading, state, systemPromptInfo, providerType, error, send, changeRole, resetError } = useAiChat({
    entryMode,
    initialContext,
    open,
    tabId,  // 传入 tabId
  })
  
  // ... 其他代码不变
}
```

### 3.6 修改 WorkspaceShell

```typescript
// app/src/components/WorkspaceShell.tsx

// 1. 在使用 AiChatDialog 的地方传递 tabId
{aiChatState && activeTab && (
  <AiChatDialog
    open={aiChatState.open}
    entryMode={aiChatState.entryMode}
    initialContext={aiChatState.initialContext}
    onClose={closeAiChatDialog}
    tabId={activeTab.id}  // 传入当前 tab 的 ID
  />
)}

// 2. 在关闭 tab 时清理会话
const closeTab = useCallback((tabId: string) => {
  // 清理对应的 AI Chat 会话
  aiChatSessionManager.deleteSession(tabId)
  
  // ... 原有的关闭 tab 逻辑
}, [])
```

## 四、实施步骤

### 阶段 1：创建会话管理器（基础设施）

**任务清单**：
- [ ] 创建 `app/src/modules/ai/domain/aiChatSessionManager.ts`
  - 定义 `PersistedAiChatSession` 类型
  - 定义 `IAiChatSessionManager` 接口

- [ ] 创建 `app/src/modules/ai/application/localStorageAiChatSessionManager.ts`
  - 实现 `LocalStorageAiChatSessionManager` 类
  - 导出单例 `aiChatSessionManager`
  - 实现 localStorage 读写逻辑
  - 添加错误处理

- [ ] 编写单元测试
  - 测试保存/加载会话
  - 测试删除会话
  - 测试清理所有会话

**验证标准**：
- 会话管理器可以正常创建实例
- 可以保存和加载会话数据
- 删除会话后无法再次获取

---

### 阶段 2：修改 chatSessionService（核心逻辑）

**任务清单**：
- [ ] 修改 `app/src/modules/ai/application/chatSessionService.ts`
  - 在 `StartChatOptions` 中添加 `initialState?: ConversationState` 参数
  - 修改 `createChatSession` 函数，支持传入初始状态
  - 当 `initialState` 存在时，使用它而不是创建新状态

- [ ] 编写集成测试
  - 测试传入 `initialState` 时会话恢复正确
  - 测试不传入 `initialState` 时创建新会话

**验证标准**：
- 可以通过 `initialState` 恢复会话
- 不传入 `initialState` 时行为与之前一致

---

### 阶段 3：修改 useAiChat Hook（核心逻辑）

**任务清单**：
- [ ] 修改 `app/src/modules/ai/ui/hooks/useAiChat.ts`
  - 在 `UseAiChatOptions` 中添加 `tabId: string` 参数
  - 修改 `useEffect` 逻辑：
    - 打开时先尝试从存储恢复会话
    - 如果有已保存的会话，恢复其状态
    - 如果没有，创建新会话
  - 修改清理逻辑：不再 `dispose` session
  - 在 `send` 函数中保存会话状态
  - 在 `changeRole` 函数中保存会话状态

- [ ] 编写单元测试
  - 测试会话恢复逻辑
  - 测试新会话创建逻辑
  - 测试状态保存逻辑

**验证标准**：
- 打开已存在会话的 tab 时，历史记录正确恢复
- 打开新 tab 时，创建新会话
- 发送消息后，状态正确保存

---

### 阶段 4：修改 AiChatDialog 组件（UI 层）

**任务清单**：
- [ ] 修改 `app/src/modules/ai/ui/AiChatDialog.tsx`
  - 在 `AiChatDialogProps` 中添加 `tabId: string` 属性
  - 将 `tabId` 传递给 `useAiChat` hook

**验证标准**：
- 组件可以接收 `tabId` prop
- `tabId` 正确传递给 `useAiChat`

---

### 阶段 5：修改 WorkspaceShell（集成层）

**任务清单**：
- [ ] 修改 `app/src/components/WorkspaceShell.tsx`
  - 在渲染 `AiChatDialog` 时，传递 `activeTab.id` 作为 `tabId`
  - 在 `closeTab` 函数中，调用 `aiChatSessionManager.deleteSession(tabId)`
  - 确保 `activeTab` 存在时才渲染 `AiChatDialog`

- [ ] 添加导入
  - 导入 `aiChatSessionManager`

**验证标准**：
- AI Chat 可以正常打开
- `tabId` 正确传递
- 关闭 tab 时，对应会话被清理

---

### 阶段 6：集成测试

**测试用例**：

1. **同一 tab 多次打开/关闭**
   - 在 Tab 1 中打开 AI Chat，发送几条消息
   - 关闭 AI Chat 对话框
   - 再次打开 AI Chat 对话框
   - 验证：历史消息完整保留

2. **不同 tab 间会话独立**
   - 在 Tab 1 中打开 AI Chat，发送消息 A
   - 切换到 Tab 2，打开 AI Chat，发送消息 B
   - 切换回 Tab 1，打开 AI Chat
   - 验证：Tab 1 只显示消息 A，不显示消息 B

3. **切换 tab 后再打开 AI Chat**
   - 在 Tab 1 中打开 AI Chat，发送几条消息
   - 关闭 AI Chat
   - 切换到 Tab 2
   - 再切换回 Tab 1
   - 打开 AI Chat
   - 验证：会话正确恢复

4. **关闭 tab 时清理会话**
   - 在 Tab 1 中打开 AI Chat，发送几条消息
   - 关闭 Tab 1
   - 重新打开 Tab 1（或创建新 tab 并使用相同 ID）
   - 打开 AI Chat
   - 验证：会话已被清理，为新会话

5. **应用重启后会话保持**
   - （仅适用于文件系统存储方案）
   - 打开应用，在 Tab 1 中打开 AI Chat，发送消息
   - 关闭 AI Chat
   - 重启应用
   - 打开 Tab 1，打开 AI Chat
   - 验证：会话正确恢复

---

### 阶段 7：优化与增强（可选）

**可选功能**：

1. **会话历史管理**
   - 在 AI Chat 对话框中添加"清空会话"按钮
   - 显示当前会话的创建时间和消息数量

2. **会话导出/导入**
   - 支持将会话导出为 JSON 文件
   - 支持从 JSON 文件导入会话

3. **自动清理策略**
   - 超过 N 天未使用的会话自动删除
   - 限制最大会话数量

4. **存储升级**
   - 从 localStorage 升级到文件系统存储
   - 添加数据迁移逻辑

## 五、技术细节

### 5.1 数据流转

```
用户操作
  │
  ├─ 发送消息
  │   └─ useAiChat.send()
  │       └─ session.sendUserMessage()
  │           └─ 触发 onStateChange 回调
  │               └─ setState()
  │                   └─ aiChatSessionManager.saveSession()
  │                       └─ localStorage.setItem()
  │
  ├─ 切换角色
  │   └─ useAiChat.changeRole()
  │       └─ session.setActiveRole()
  │           └─ 获取新的 systemPromptInfo
  │               └─ aiChatSessionManager.saveSession()
  │                   └─ localStorage.setItem()
  │
  └─ 打开对话框
      └─ useAiChat.useEffect()
          └─ aiChatSessionManager.getOrCreateSession()
              ├─ 有会话 → 恢复状态
              └─ 无会话 → 创建新会话
                  └─ aiChatSessionManager.saveSession()
```

### 5.2 关键点说明

#### 1. 为什么不 dispose session？

**问题**：如果每次关闭对话框都 dispose session，就无法恢复会话状态。

**解决方案**：在 `useEffect` 的清理函数中，不再调用 `session.dispose()`，保留 session 对象。

**注意事项**：
- 保留 session 对象可能导致内存泄漏
- 需要在关闭 tab 时清理 session
- 可以考虑使用 WeakMap 或定期清理机制

#### 2. 如何保证数据一致性？

**策略**：
- 每次 `onStateChange` 触发时都保存状态
- 在发送消息和切换角色后立即保存
- 使用 `updatedAt` 时间戳记录最后更新时间

#### 3. 如何处理并发问题？

**潜在问题**：快速切换 tab 时，异步操作可能导致状态不一致。

**解决方案**：
- 使用 `cancelled` 标志取消未完成的异步操作
- 在 `useEffect` 清理函数中设置 `cancelled = true`
- 保存和加载操作都添加 `if (cancelled) return` 检查

#### 4. 如何处理数据结构变化？

**问题**：如果 `ConversationState` 结构变化，旧数据可能无法加载。

**解决方案**：
- 添加数据版本号字段
- 实现数据迁移逻辑
- 提供兜底方案，加载失败时创建新会话

### 5.3 性能考虑

1. **localStorage 限制**：
   - 大小限制：5-10MB
   - 写入频率：避免频繁写入（每次消息发送）
   - 优化：可以批量写入或使用防抖

2. **内存占用**：
   - 保留所有 session 对象可能导致内存泄漏
   - 方案：使用 WeakMap 或定期清理未使用的 session

3. **存储策略**：
   - 仅存储必要数据（不存储 session 对象本身）
   - 考虑使用压缩减少存储大小

## 六、风险评估与缓解

### 6.1 已知风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| localStorage 空间不足 | 会话丢失 | 中 | 定期清理旧会话，监控存储使用量 |
| 内存泄漏 | 应用卡顿 | 中 | 关闭 tab 时清理 session，使用 WeakMap |
| 数据结构变化导致旧数据无法加载 | 会话丢失 | 低 | 添加版本号，实现数据迁移 |
| 并发问题导致状态不一致 | 数据错误 | 低 | 使用 cancelled 标志，添加防抖 |
| 快速切换 tab 导致加载错误 | 用户体验差 | 中 | 添加加载状态和错误处理 |

### 6.2 监控指标

1. **存储使用量**：监控 localStorage 使用量，超过阈值时提示用户清理
2. **内存占用**：监控内存使用，发现异常增长时主动清理
3. **会话数量**：限制最大会话数量，避免过度存储
4. **错误率**：监控保存/加载失败率，及时发现数据问题

## 七、测试计划

### 7.1 单元测试

```typescript
// 示例：会话管理器测试

describe('LocalStorageAiChatSessionManager', () => {
  let manager: LocalStorageAiChatSessionManager
  
  beforeEach(() => {
    localStorage.clear()
    manager = new LocalStorageAiChatSessionManager()
  })
  
  it('should save and retrieve session', () => {
    const session: PersistedAiChatSession = {
      tabId: 'tab-1',
      state: mockState,
      systemPromptInfo: null,
      providerType: 'openai',
      entryMode: 'chat',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    
    manager.saveSession('tab-1', {
      state: session.state,
      systemPromptInfo: session.systemPromptInfo,
      providerType: session.providerType,
    })
    
    const retrieved = manager.getOrCreateSession('tab-1')
    expect(retrieved).toEqual(session)
  })
  
  it('should delete session', () => {
    manager.saveSession('tab-1', mockData)
    manager.deleteSession('tab-1')
    
    const retrieved = manager.getOrCreateSession('tab-1')
    expect(retrieved).toBeNull()
  })
  
  // 更多测试...
})
```

### 7.2 集成测试

使用 React Testing Library 测试完整流程：

```typescript
// 示例：集成测试

describe('AI Chat Session Integration', () => {
  it('should restore session when reopening dialog', async () => {
    // 打开 AI Chat
    fireEvent.click(getByText('AI Chat'))
    
    // 发送消息
    const input = getByPlaceholderText('向 AI 提问')
    fireEvent.change(input, { target: { value: 'Hello' } })
    fireEvent.click(getByText('发送'))
    
    // 等待响应
    await waitFor(() => {
      expect(getByText(/AI Response/)).toBeInTheDocument()
    })
    
    // 关闭对话框
    fireEvent.click(getByLabelText('关闭'))
    
    // 再次打开
    fireEvent.click(getByText('AI Chat'))
    
    // 验证历史消息保留
    expect(getByText('Hello')).toBeInTheDocument()
    expect(getByText(/AI Response/)).toBeInTheDocument()
  })
})
```

### 7.3 手动测试清单

- [ ] 同一 tab 多次打开/关闭，会话保持
- [ ] 不同 tab 间会话独立
- [ ] 切换 tab 后再打开，会话正确恢复
- [ ] 关闭 tab 时，会话被清理
- [ ] 应用重启后，会话保持（文件系统方案）
- [ ] 快速切换 tab，不会出现错误
- [ ] 大量消息时，性能正常
- [ ] 清空会话后，可以重新开始

## 八、未来扩展

### 8.1 可能的增强功能

1. **多会话管理**
   - 同一个 tab 支持多个会话
   - 可以在不同的会话间切换

2. **会话分组**
   - 按项目、主题或时间分组
   - 支持文件夹管理

3. **会话搜索**
   - 在所有会话中搜索关键词
   - 高亮显示匹配内容

4. **会话分享**
   - 导出为 Markdown 格式
   - 生成分享链接

5. **AI 记忆增强**
   - 长期记忆存储
   - 跨会话的知识积累

### 8.2 技术升级路线

1. **v1.0（当前）**：localStorage 存储
2. **v1.5**：文件系统存储
3. **v2.0**：支持多会话
4. **v2.5**：会话分组和搜索
5. **v3.0**：长期记忆和知识库

## 九、总结

本方案通过引入会话管理器，实现了按 tab 管理 AI Chat 会话的能力。核心思路包括：

1. **持久化存储**：使用 localStorage 或文件系统存储会话状态
2. **生命周期管理**：创建、加载、保存、清理四个阶段
3. **按 tab 隔离**：每个 tab 维护独立的会话
4. **状态恢复**：打开对话框时自动恢复历史会话

方案分为 7 个阶段实施，每个阶段都有明确的验证标准。通过单元测试、集成测试和手动测试，确保功能的正确性和稳定性。

未来可以根据需求逐步扩展，增加多会话、会话分组、搜索等功能，最终实现完整的会话管理系统。
