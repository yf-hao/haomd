# HaoMD 测试覆盖实施方案

**制定日期**: 2026-02-12  
**目标**: 提升项目测试覆盖率，建立完善的测试体系

---

## 1. 现状分析

### 1.1 技术栈概览

| 层级 | 技术 | 版本 |
|------|------|------|
| **前端框架** | React | 19.2.4 |
| **开发语言** | TypeScript | 5.9.3 (strict mode) |
| **构建工具** | Vite (rolldown-vite) | 7.2.5 |
| **测试框架** | Vitest | 1.6.1 |
| **测试环境** | jsdom | 28.0.0 |
| **测试库** | @testing-library/react | 14.3.1 |
| **断言扩展** | @testing-library/jest-dom | 6.9.1 |

### 1.2 现有测试文件统计

| 测试文件 | 测试内容 | 测试类型 | 评价 |
|---------|---------|---------|------|
| `hooks/useWorkspaceLayout.test.tsx` | Hook导出检查 | 导出验证 | ⚠️ 测试不充分 |
| `modules/ai/settings.test.ts` | Settings映射函数 | 单元测试 | ✅ 测试合理 |
| `modules/files/service.test.ts` | 文件服务辅助函数 | 单元测试 | ✅ 测试合理 |
| `modules/commands/registry.test.ts` | 命令注册 | 单元测试 | ✅ 测试合理 |
| `modules/ai/application/localStorageAiChatSessionManager.test.ts` | 会话管理 | 单元测试 | ✅ 测试完善 |

### 1.3 测试覆盖缺失分析

#### 缺失的模块测试

```
modules/
├── ai/
│   ├── domain/         ❌ 无测试 - 核心领域类型和业务逻辑
│   ├── application/    ⚠️ 仅1个测试 - 缺少其他服务测试
│   ├── openai/         ❌ 无测试 - OpenAI适配器
│   ├── dify/           ❌ 无测试 - Dify适配器
│   ├── vision/         ❌ 无测试 - 视觉能力模块
│   └── ui/             ❌ 无测试 - AI UI组件
├── files/              ⚠️ 仅测试辅助函数 - 核心服务未测试
├── export/             ❌ 无测试 - 导出功能
├── markdown/           ❌ 无测试 - Markdown渲染
├── outline/            ❌ 无测试 - 大纲功能
├── platform/           ❌ 无测试 - 平台适配层
├── sidebar/            ❌ 无测试 - 侧边栏模块
└── visualization/      ❌ 无测试 - 可视化模块
```

#### 缺失的Hooks测试

```
hooks/
├── useWorkspaceLayout.ts        ⚠️ 仅检查导出 - 缺少功能测试
├── useAiSettingsPersistence.ts  ❌ 无测试
├── useAiSettingsState.ts        ❌ 无测试
├── useCommandSystem.ts          ❌ 无测试
├── useConfirmDialogs.ts         ❌ 无测试
├── useFilePersistence.ts        ❌ 无测试
├── useNativePaste.ts            ❌ 无测试
├── useOutline.ts                ❌ 无测试
├── usePromptSettingsPersistence.ts ❌ 无测试
├── usePromptSettingsState.ts    ❌ 无测试
├── useSidebar.ts                ❌ 无测试
├── useSidebarActions.ts         ❌ 无测试
└── useTabs.ts                   ❌ 无测试
```

#### 缺失的组件测试

```
components/
├── EditorPane.tsx       ❌ 无测试
├── PreviewPane.tsx      ❌ 无测试
├── Sidebar.tsx          ❌ 无测试
├── TabBar.tsx           ❌ 无测试
├── WorkspaceShell.tsx   ❌ 无测试
└── AiSettingsDialog.tsx ❌ 无测试
```

---

## 2. 测试策略

### 2.1 测试金字塔

```
           /\
          /  \     E2E测试 (10%)
         /----\    - 用户场景测试
        /      \   
       /--------\  集成测试 (20%)
      /          \ - Hooks测试
     /            \- 组件交互测试
    /--------------\
   /                \ 单元测试 (70%)
  /                  \- 纯函数测试
 /                    \- 工具类测试
/                      - Domain逻辑测试
```

### 2.2 测试优先级原则

#### P0 - 最高优先级（核心业务逻辑）
- AI模块的domain层（类型、业务规则）
- 文件系统核心服务
- 会话管理服务

#### P1 - 高优先级（关键功能）
- AI Provider适配器（OpenAI、Dify）
- Hooks功能测试
- Markdown渲染核心

#### P2 - 中优先级（重要功能）
- React组件测试
- 导出功能
- 大纲和可视化模块

#### P3 - 低优先级（辅助功能）
- 平台适配层
- 边缘场景测试

### 2.3 测试类型划分

| 测试类型 | 工具 | 适用场景 | 目标覆盖率 |
|---------|------|---------|-----------|
| **单元测试** | Vitest | 纯函数、工具类、Domain层 | 90%+ |
| **Hook测试** | @testing-library/react-hooks | 自定义Hooks | 80%+ |
| **组件测试** | @testing-library/react | React组件 | 70%+ |
| **集成测试** | Vitest + mocks | 模块间协作 | 60%+ |

---

## 3. 测试框架配置优化

### 3.1 安装覆盖率工具

```bash
# 安装覆盖率报告工具
npm install -D @vitest/coverage-v8
```

### 3.2 更新 vitest.config.ts

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './vitest.setup.ts',
    
    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      
      // 覆盖率阈值
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60
      },
      
      // 排除文件
      exclude: [
        'node_modules/**',
        'src/main.tsx',
        'src/vite-env.d.ts',
        '**/*.d.ts',
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        '**/__tests__/**',
        '**/types.ts'  // 纯类型定义文件
      ]
    },
    
    // 测试文件匹配模式
    include: ['**/*.{test,spec}.{ts,tsx}'],
    
    // 并发配置
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false
      }
    }
  }
})
```

### 3.3 更新 package.json scripts

```json
{
  "scripts": {
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:watch": "vitest watch"
  }
}
```

### 3.4 创建 vitest.setup.ts 增强

```typescript
// vitest.setup.ts
import { expect, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'

// 扩展 Jest DOM 匹配器
expect.extend(matchers)

// 每个测试后清理 DOM
afterEach(() => {
  cleanup()
})

// Mock Tauri API
const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api', () => ({
  invoke: mockInvoke,
}))

// Mock Tauri Plugins
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
}))

// 全局测试工具
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}))

// 导出 mock 供测试使用
export { mockInvoke }
```

---

## 4. 测试工具库

### 4.1 创建测试工具文件

创建 `src/test-utils/index.ts`：

```typescript
// src/test-utils/index.ts
import { render, RenderOptions } from '@testing-library/react'
import { ReactElement } from 'react'

// Mock Provider 包装器
export function createWrapper() {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <>{children}</>
  }
}

// 自定义 render 函数
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  const Wrapper = createWrapper()
  return render(ui, { wrapper: Wrapper, ...options })
}

// Mock 工厂函数
export function createMockFilePayload(overrides = {}) {
  return {
    path: '/test/file.md',
    content: '# Test Content',
    displayName: 'file.md',
    ...overrides
  }
}

export function createMockTab(overrides = {}) {
  return {
    id: 'tab-1',
    path: '/test/file.md',
    displayName: 'file.md',
    isDirty: false,
    content: '# Test',
    ...overrides
  }
}

export function createMockAiSettings(overrides = {}) {
  return {
    providers: [],
    defaultProviderId: undefined,
    ...overrides
  }
}

// 重导出 testing-library
export * from '@testing-library/react'
export { renderWithProviders as render }
```

### 4.2 Mock 工具集

创建 `src/test-utils/mocks.ts`：

```typescript
// src/test-utils/mocks.ts
import { vi } from 'vitest'

// Mock Tauri Backend
export function createMockTauriBackend() {
  return {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    openFile: vi.fn(),
    saveFile: vi.fn(),
    listRecentFiles: vi.fn(),
    clearRecentFiles: vi.fn(),
  }
}

// Mock AI Client
export function createMockAiClient() {
  return {
    openChat: vi.fn().mockResolvedValue({ ok: true, message: 'AI response' }),
    askAboutFile: vi.fn().mockResolvedValue({ ok: true, message: 'File analysis' }),
    askAboutSelection: vi.fn().mockResolvedValue({ ok: true, message: 'Selection analysis' }),
    streamChat: vi.fn().mockImplementation(async function* () {
      yield 'Hello'
      yield ' World'
    }),
  }
}

// Mock File System
export function createMockFileService() {
  return {
    openFile: vi.fn(),
    saveFile: vi.fn(),
    newFile: vi.fn(),
    watchFile: vi.fn(),
    unwatchFile: vi.fn(),
  }
}
```

---

## 5. 模块测试计划

### 5.1 AI 模块测试

#### 5.1.1 Domain 层测试

**文件**: `modules/ai/domain/types.test.ts`

```typescript
describe('AI Domain Types', () => {
  describe('Result type', () => {
    it('should create success result', () => {
      const result: Result<string> = { ok: true, data: 'test' }
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBe('test')
      }
    })

    it('should create error result', () => {
      const result: Result<string> = { 
        ok: false, 
        error: { code: 'UNKNOWN', message: 'Error' }
      }
      expect(result.ok).toBe(false)
    })
  })

  describe('Provider types', () => {
    it('should validate UiProvider structure', () => {
      const provider: UiProvider = {
        id: 'test',
        name: 'Test Provider',
        baseUrl: 'https://api.test.com',
        apiKey: 'key',
        models: [{ id: 'model-1' }],
      }
      expect(provider.id).toBe('test')
    })
  })
})
```

**测试覆盖内容**:
- ✅ Result 类型的成功/失败分支
- ✅ UiProvider 类型验证
- ✅ ChatEntry 类型验证
- ✅ VisionMode 枚举值

#### 5.1.2 Application 层测试

**文件**: `modules/ai/application/chatSessionService.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChatSessionService } from './chatSessionService'
import { createMockAiClient } from '@/test-utils/mocks'

describe('ChatSessionService', () => {
  let service: ChatSessionService
  let mockClient: ReturnType<typeof createMockAiClient>

  beforeEach(() => {
    mockClient = createMockAiClient()
    service = new ChatSessionService(mockClient)
  })

  it('should create new chat session', () => {
    const tabId = 'tab-1'
    const session = service.createSession(tabId)
    expect(session.tabId).toBe(tabId)
    expect(session.state.engineHistory).toEqual([])
  })

  it('should add message to session', () => {
    const tabId = 'tab-1'
    service.createSession(tabId)
    
    service.addMessage(tabId, {
      role: 'user',
      content: 'Hello'
    })
    
    const session = service.getSession(tabId)
    expect(session?.state.engineHistory).toHaveLength(1)
  })

  it('should handle session deletion', () => {
    const tabId = 'tab-1'
    service.createSession(tabId)
    service.deleteSession(tabId)
    
    expect(service.getSession(tabId)).toBeNull()
  })
})
```

**测试覆盖内容**:
- ✅ 会话创建
- ✅ 消息添加
- ✅ 会话删除
- ✅ 会话持久化
- ✅ 系统提示词管理

#### 5.1.3 OpenAI 适配器测试

**文件**: `modules/ai/openai/openaiClient.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OpenAIClient } from './openaiClient'

// Mock fetch
global.fetch = vi.fn()

describe('OpenAIClient', () => {
  let client: OpenAIClient

  beforeEach(() => {
    client = new OpenAIClient({
      baseUrl: 'https://api.openai.com',
      apiKey: 'test-key',
      model: 'gpt-4'
    })
    vi.clearAllMocks()
  })

  it('should send chat completion request', async () => {
    const mockResponse = {
      choices: [{
        message: { content: 'Hello!' }
      }]
    }
    
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response)

    const result = await client.chat('Hi')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toContain('Hello')
    }
  })

  it('should handle API errors', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    } as Response)

    const result = await client.chat('Hi')
    expect(result.ok).toBe(false)
  })

  it('should stream chat responses', async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"content":"Hello"}\n\n'))
        controller.close()
      }
    })

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      body: mockStream,
    } as Response)

    const chunks: string[] = []
    for await (const chunk of client.streamChat('Hi')) {
      chunks.push(chunk)
    }
    
    expect(chunks.length).toBeGreaterThan(0)
  })
})
```

**测试覆盖内容**:
- ✅ Chat completion 请求
- ✅ 流式响应处理
- ✅ 错误处理
- ✅ Vision 支持
- ✅ API 密钥验证

#### 5.1.4 Dify 适配器测试

**文件**: `modules/ai/dify/difyClient.test.ts`

测试内容类似 OpenAI，但需要针对 Dify 的特殊功能：
- ✅ Conversation ID 管理
- ✅ Workflow 支持
- ✅ 文件上传
- ✅ 流式响应

---

### 5.2 Files 模块测试

#### 5.2.1 文件服务测试

**文件**: `modules/files/service.test.ts` (扩展现有)

```typescript
describe('Files Service', () => {
  describe('readFile', () => {
    it('should read file content', async () => {
      const mockContent = '# Test File'
      mockInvoke.mockResolvedValueOnce({ 
        ok: true, 
        data: { content: mockContent }
      })

      const result = await readFile('/test/file.md')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.content).toBe(mockContent)
      }
    })

    it('should handle file not found', async () => {
      mockInvoke.mockResolvedValueOnce({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'File not found' }
      })

      const result = await readFile('/nonexistent.md')
      expect(result.ok).toBe(false)
    })

    it('should handle file too large', async () => {
      mockInvoke.mockResolvedValueOnce({
        ok: false,
        error: { code: 'TOO_LARGE', message: 'File exceeds 20MB limit' }
      })

      const result = await readFile('/large-file.md')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('TOO_LARGE')
      }
    })
  })

  describe('writeFile', () => {
    it('should write file successfully', async () => {
      mockInvoke.mockResolvedValueOnce({ ok: true })

      const result = await writeFile('/test/file.md', 'content')
      expect(result.ok).toBe(true)
      expect(mockInvoke).toHaveBeenCalledWith('write_file', {
        path: '/test/file.md',
        content: 'content'
      })
    })

    it('should handle write permission error', async () => {
      mockInvoke.mockResolvedValueOnce({
        ok: false,
        error: { code: 'PERMISSION_DENIED', message: 'Permission denied' }
      })

      const result = await writeFile('/protected/file.md', 'content')
      expect(result.ok).toBe(false)
    })
  })

  describe('recent files management', () => {
    it('should merge recent files correctly', () => {
      const base: RecentFile[] = [
        { path: '/a.md', displayName: 'a', lastOpenedAt: 1, isFolder: false }
      ]
      const newEntry: RecentFile = { 
        path: '/b.md', 
        displayName: 'b', 
        lastOpenedAt: 2, 
        isFolder: false 
      }

      const merged = mergeRecent(base, newEntry, 10)
      expect(merged).toHaveLength(2)
      expect(merged[0].path).toBe('/b.md') // Most recent first
    })

    it('should limit recent files to configured max', () => {
      const files: RecentFile[] = Array.from({ length: 20 }, (_, i) => ({
        path: `/file${i}.md`,
        displayName: `file${i}.md`,
        lastOpenedAt: i,
        isFolder: false
      }))

      const merged = mergeRecent(files, files[19], 10)
      expect(merged.length).toBeLessThanOrEqual(10)
    })
  })
})
```

---

### 5.3 Markdown 模块测试

**文件**: `modules/markdown/renderer.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { renderMarkdown } from './renderer'

describe('Markdown Renderer', () => {
  it('should render basic markdown', () => {
    const md = '# Hello\n\nWorld'
    const html = renderMarkdown(md)
    expect(html).toContain('<h1>Hello</h1>')
    expect(html).toContain('<p>World</p>')
  })

  it('should support GFM (GitHub Flavored Markdown)', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |'
    const html = renderMarkdown(md)
    expect(html).toContain('<table>')
    expect(html).toContain('<td>')
  })

  it('should render math with KaTeX', () => {
    const md = '$E = mc^2$'
    const html = renderMarkdown(md)
    expect(html).toContain('katex')
  })

  it('should render Mermaid diagrams', () => {
    const md = '```mermaid\ngraph TD\nA-->B\n```'
    const html = renderMarkdown(md)
    expect(html).toContain('mermaid')
  })

  it('should sanitize dangerous HTML', () => {
    const md = '<script>alert("XSS")</script>'
    const html = renderMarkdown(md)
    expect(html).not.toContain('<script>')
  })
})
```

---

### 5.4 Export 模块测试

**文件**: `modules/export/htmlExporter.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest'
import { exportToHtml } from './htmlExporter'

describe('HTML Exporter', () => {
  it('should export markdown to HTML', async () => {
    const md = '# Test\n\nContent'
    const result = await exportToHtml(md, '/output/test.html')
    
    expect(result.ok).toBe(true)
    expect(mockInvoke).toHaveBeenCalledWith('export_html', expect.any(Object))
  })

  it('should include styles in exported HTML', async () => {
    const md = '# Test'
    const result = await exportToHtml(md, '/output/test.html', {
      includeStyles: true
    })
    
    expect(result.ok).toBe(true)
  })

  it('should handle export errors', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('Export failed'))
    
    const result = await exportToHtml('test', '/invalid/path')
    expect(result.ok).toBe(false)
  })
})
```

---

## 6. Hooks 测试计划

### 6.1 useTabs Hook 测试

**文件**: `hooks/useTabs.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTabs } from './useTabs'
import { createMockTab } from '@/test-utils'

describe('useTabs', () => {
  it('should create new tab', () => {
    const { result } = renderHook(() => useTabs())

    act(() => {
      result.current.createTab('/test.md')
    })

    expect(result.current.tabs).toHaveLength(1)
    expect(result.current.activeTabId).toBe(result.current.tabs[0].id)
  })

  it('should close tab', () => {
    const { result } = renderHook(() => useTabs())

    act(() => {
      result.current.createTab('/test.md')
    })

    const tabId = result.current.tabs[0].id

    act(() => {
      result.current.closeTab(tabId)
    })

    expect(result.current.tabs).toHaveLength(0)
  })

  it('should switch active tab', () => {
    const { result } = renderHook(() => useTabs())

    act(() => {
      result.current.createTab('/test1.md')
      result.current.createTab('/test2.md')
    })

    const secondTabId = result.current.tabs[1].id

    act(() => {
      result.current.setActiveTab(secondTabId)
    })

    expect(result.current.activeTabId).toBe(secondTabId)
  })

  it('should mark tab as dirty when content changes', () => {
    const { result } = renderHook(() => useTabs())

    act(() => {
      result.current.createTab('/test.md')
    })

    const tabId = result.current.tabs[0].id

    act(() => {
      result.current.updateTabContent(tabId, 'modified content')
    })

    const tab = result.current.tabs.find(t => t.id === tabId)
    expect(tab?.isDirty).toBe(true)
  })
})
```

### 6.2 useFilePersistence Hook 测试

**文件**: `hooks/useFilePersistence.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useFilePersistence } from './useFilePersistence'
import { mockInvoke } from '@/test-utils/mocks'

describe('useFilePersistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should open file and set content', async () => {
    mockInvoke.mockResolvedValueOnce({
      ok: true,
      data: { content: '# Test File', path: '/test.md' }
    })

    const { result } = renderHook(() => useFilePersistence())

    await act(async () => {
      await result.current.openFile('/test.md')
    })

    expect(result.current.content).toBe('# Test File')
    expect(result.current.filePath).toBe('/test.md')
  })

  it('should save file', async () => {
    mockInvoke.mockResolvedValue({ ok: true })

    const { result } = renderHook(() => useFilePersistence())

    act(() => {
      result.current.setContent('test content')
      result.current.setFilePath('/test.md')
    })

    await act(async () => {
      await result.current.save()
    })

    expect(mockInvoke).toHaveBeenCalledWith('write_file', expect.objectContaining({
      path: '/test.md',
      content: 'test content'
    }))
    expect(result.current.hasUnsavedChanges).toBe(false)
  })

  it('should track unsaved changes', () => {
    const { result } = renderHook(() => useFilePersistence())

    act(() => {
      result.current.setContent('initial content')
    })

    expect(result.current.hasUnsavedChanges).toBe(true)
  })

  it('should handle save errors', async () => {
    mockInvoke.mockResolvedValueOnce({
      ok: false,
      error: { code: 'IO_ERROR', message: 'Disk full' }
    })

    const { result } = renderHook(() => useFilePersistence())

    act(() => {
      result.current.setContent('test')
      result.current.setFilePath('/test.md')
    })

    await act(async () => {
      const saveResult = await result.current.save()
      expect(saveResult.ok).toBe(false)
    })
  })
})
```

### 6.3 useSidebar Hook 测试

**文件**: `hooks/useSidebar.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSidebar } from './useSidebar'

describe('useSidebar', () => {
  it('should toggle sidebar visibility', () => {
    const { result } = renderHook(() => useSidebar())

    expect(result.current.isVisible).toBe(true)

    act(() => {
      result.current.toggleVisibility()
    })

    expect(result.current.isVisible).toBe(false)
  })

  it('should expand/collapse folders', () => {
    const { result } = renderHook(() => useSidebar())

    const folderPath = '/test/folder'

    act(() => {
      result.current.toggleFolder(folderPath)
    })

    expect(result.current.expandedFolders.has(folderPath)).toBe(true)

    act(() => {
      result.current.toggleFolder(folderPath)
    })

    expect(result.current.expandedFolders.has(folderPath)).toBe(false)
  })

  it('should set active file', () => {
    const { result } = renderHook(() => useSidebar())

    act(() => {
      result.current.setActiveFile('/test/file.md')
    })

    expect(result.current.activeFile).toBe('/test/file.md')
  })
})
```

---

## 7. 组件测试计划

### 7.1 TabBar 组件测试

**文件**: `components/TabBar.test.tsx`

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TabBar } from './TabBar'
import { createMockTab } from '@/test-utils'

describe('TabBar', () => {
  const mockTabs = [
    createMockTab({ id: 'tab-1', displayName: 'file1.md' }),
    createMockTab({ id: 'tab-2', displayName: 'file2.md', isDirty: true }),
  ]

  it('should render all tabs', () => {
    render(
      <TabBar
        tabs={mockTabs}
        activeTabId="tab-1"
        onTabClick={vi.fn()}
        onTabClose={vi.fn()}
      />
    )

    expect(screen.getByText('file1.md')).toBeInTheDocument()
    expect(screen.getByText('file2.md')).toBeInTheDocument()
  })

  it('should highlight active tab', () => {
    render(
      <TabBar
        tabs={mockTabs}
        activeTabId="tab-1"
        onTabClick={vi.fn()}
        onTabClose={vi.fn()}
      />
    )

    const activeTab = screen.getByText('file1.md').closest('button')
    expect(activeTab).toHaveClass('active')
  })

  it('should show dirty indicator', () => {
    render(
      <TabBar
        tabs={mockTabs}
        activeTabId="tab-1"
        onTabClick={vi.fn()}
        onTabClose={vi.fn()}
      />
    )

    const dirtyTab = screen.getByText('file2.md').parentElement
    expect(dirtyTab).toHaveTextContent('●')
  })

  it('should call onTabClick when tab clicked', () => {
    const handleClick = vi.fn()

    render(
      <TabBar
        tabs={mockTabs}
        activeTabId="tab-1"
        onTabClick={handleClick}
        onTabClose={vi.fn()}
      />
    )

    fireEvent.click(screen.getByText('file2.md'))

    expect(handleClick).toHaveBeenCalledWith('tab-2')
  })

  it('should call onTabClose when close button clicked', () => {
    const handleClose = vi.fn()

    render(
      <TabBar
        tabs={mockTabs}
        activeTabId="tab-1"
        onTabClick={vi.fn()}
        onTabClose={handleClose}
      />
    )

    const closeButtons = screen.getAllByLabelText('Close tab')
    fireEvent.click(closeButtons[1])

    expect(handleClose).toHaveBeenCalledWith('tab-2')
  })
})
```

### 7.2 Sidebar 组件测试

**文件**: `components/Sidebar.test.tsx`

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Sidebar } from './Sidebar'

describe('Sidebar', () => {
  const mockProps = {
    isVisible: true,
    items: [
      { type: 'folder', name: 'Folder1', path: '/folder1', children: [] },
      { type: 'file', name: 'file1.md', path: '/file1.md' },
    ],
    expandedFolders: new Set(['/folder1']),
    activeFile: '/file1.md',
    onFileClick: vi.fn(),
    onFolderToggle: vi.fn(),
    onClose: vi.fn(),
  }

  it('should render file tree', () => {
    render(<Sidebar {...mockProps} />)

    expect(screen.getByText('Folder1')).toBeInTheDocument()
    expect(screen.getByText('file1.md')).toBeInTheDocument()
  })

  it('should hide when isVisible is false', () => {
    render(<Sidebar {...mockProps} isVisible={false} />)

    const sidebar = screen.queryByRole('navigation')
    expect(sidebar).not.toBeInTheDocument()
  })

  it('should call onFileClick when file clicked', () => {
    render(<Sidebar {...mockProps} />)

    fireEvent.click(screen.getByText('file1.md'))

    expect(mockProps.onFileClick).toHaveBeenCalledWith('/file1.md')
  })

  it('should call onFolderToggle when folder clicked', () => {
    render(<Sidebar {...mockProps} />)

    fireEvent.click(screen.getByText('Folder1'))

    expect(mockProps.onFolderToggle).toHaveBeenCalledWith('/folder1')
  })

  it('should highlight active file', () => {
    render(<Sidebar {...mockProps} />)

    const activeFile = screen.getByText('file1.md').closest('button')
    expect(activeFile).toHaveClass('active')
  })
})
```

### 7.3 EditorPane 组件测试

**文件**: `components/EditorPane.test.tsx`

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EditorPane } from './EditorPane'

// Mock CodeMirror
vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value, onChange }: any) => (
    <textarea
      data-testid="editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}))

describe('EditorPane', () => {
  it('should render editor with content', () => {
    render(
      <EditorPane
        content="# Hello World"
        onChange={vi.fn()}
      />
    )

    const editor = screen.getByTestId('editor')
    expect(editor).toHaveValue('# Hello World')
  })

  it('should call onChange when content changes', async () => {
    const handleChange = vi.fn()

    render(
      <EditorPane
        content=""
        onChange={handleChange}
      />
    )

    const editor = screen.getByTestId('editor')
    fireEvent.change(editor, { target: { value: 'new content' } })

    expect(handleChange).toHaveBeenCalledWith('new content')
  })

  it('should show line numbers', () => {
    render(
      <EditorPane
        content="line1\nline2"
        onChange={vi.fn()}
        showLineNumbers={true}
      />
    )

    // Line numbers should be visible
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})
```

---

## 8. 集成测试计划

### 8.1 文件操作流程测试

**文件**: `integration/fileOperations.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFilePersistence } from '@/hooks/useFilePersistence'
import { useTabs } from '@/hooks/useTabs'
import { mockInvoke } from '@/test-utils/mocks'

describe('File Operations Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should open file and create tab', async () => {
    mockInvoke.mockResolvedValueOnce({
      ok: true,
      data: { content: '# Test', path: '/test.md' }
    })

    const fileHook = renderHook(() => useFilePersistence())
    const tabsHook = renderHook(() => useTabs())

    // Open file
    await act(async () => {
      await fileHook.result.current.openFile('/test.md')
    })

    // Create tab for opened file
    act(() => {
      tabsHook.result.current.createTab('/test.md')
    })

    expect(fileHook.result.current.content).toBe('# Test')
    expect(tabsHook.result.current.tabs).toHaveLength(1)
  })

  it('should handle save with multiple tabs', async () => {
    mockInvoke.mockResolvedValue({ ok: true })

    const { result } = renderHook(() => useTabs())

    // Create multiple tabs
    act(() => {
      result.current.createTab('/file1.md')
      result.current.createTab('/file2.md')
    })

    // Switch and save each
    for (const tab of result.current.tabs) {
      act(() => {
        result.current.setActiveTab(tab.id)
      })
      // Would trigger save in real scenario
    }

    expect(result.current.tabs).toHaveLength(2)
  })
})
```

### 8.2 AI Chat 流程测试

**文件**: `integration/aiChat.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAiChat } from '@/modules/ai/ui/hooks/useAiChat'
import { createMockAiClient } from '@/test-utils/mocks'

describe('AI Chat Integration', () => {
  let mockClient: ReturnType<typeof createMockAiClient>

  beforeEach(() => {
    mockClient = createMockAiClient()
    vi.clearAllMocks()
  })

  it('should send message and receive response', async () => {
    const { result } = renderHook(() => useAiChat({ client: mockClient }))

    // Send message
    await act(async () => {
      await result.current.sendMessage('Hello')
    })

    expect(mockClient.openChat).toHaveBeenCalled()
    expect(result.current.messages).toHaveLength(2) // user + assistant
  })

  it('should handle streaming response', async () => {
    const { result } = renderHook(() => useAiChat({ client: mockClient }))

    await act(async () => {
      await result.current.sendMessage('Stream test')
    })

    // Check that streaming was initiated
    expect(mockClient.streamChat).toHaveBeenCalled()
  })

  it('should persist chat history', () => {
    const { result } = renderHook(() => useAiChat({ 
      client: mockClient,
      persistHistory: true 
    }))

    act(() => {
      result.current.sendMessage('Test message')
    })

    // Check localStorage
    const stored = localStorage.getItem('ai_chat_history')
    expect(stored).not.toBeNull()
  })
})
```

---

## 9. 测试覆盖率目标

### 9.1 分阶段目标

| 阶段 | 时间 | 目标覆盖率 | 重点模块 |
|------|------|-----------|---------|
| **阶段1** | 第1-2周 | 40% | AI Domain, Files Service, 核心Hooks |
| **阶段2** | 第3-4周 | 60% | AI Adapters, Markdown, 所有Hooks |
| **阶段3** | 第5-6周 | 70% | React组件, Export, Integration |
| **阶段4** | 第7-8周 | 80% | 边缘场景, E2E测试 |

### 9.2 模块级目标

| 模块 | 当前覆盖率 | 目标覆盖率 | 优先级 |
|------|-----------|-----------|--------|
| **modules/ai/domain** | 0% | 95% | P0 |
| **modules/ai/application** | 20% | 90% | P0 |
| **modules/ai/openai** | 0% | 85% | P1 |
| **modules/ai/dify** | 0% | 85% | P1 |
| **modules/files** | 30% | 90% | P0 |
| **modules/markdown** | 0% | 85% | P1 |
| **modules/export** | 0% | 80% | P2 |
| **hooks/** | 5% | 85% | P1 |
| **components/** | 0% | 75% | P2 |

---

## 10. 实施步骤

### 10.1 第一阶段：基础设施搭建（第1周）

**任务清单**:

- [ ] 安装覆盖率工具
  ```bash
  npm install -D @vitest/coverage-v8
  ```

- [ ] 更新 `vitest.config.ts` 添加覆盖率配置

- [ ] 创建 `src/test-utils/` 目录
  - [ ] `index.ts` - 测试工具函数
  - [ ] `mocks.ts` - Mock 工厂
  - [ ] `fixtures.ts` - 测试数据

- [ ] 增强 `vitest.setup.ts`
  - [ ] 添加全局 Mock
  - [ ] 配置 cleanup

- [ ] 更新 `package.json` scripts

- [ ] 创建测试模板文件
  - [ ] `.templates/test.template.ts`
  - [ ] `.templates/hook-test.template.ts`
  - [ ] `.templates/component-test.template.ts`

- [ ] 编写测试文档
  - [ ] `docs/testing-guide.md`

**验收标准**:
- ✅ `npm run test:coverage` 可以正常运行
- ✅ 覆盖率报告生成在 `coverage/` 目录
- ✅ 测试工具库可用

---

### 10.2 第二阶段：核心模块测试（第2-3周）

#### 第2周：AI Domain + Files Service

**任务清单**:

- [ ] AI Domain 层测试
  - [ ] `modules/ai/domain/types.test.ts`
  - [ ] `modules/ai/domain/chatSession.test.ts`

- [ ] AI Application 层测试
  - [ ] `modules/ai/application/chatSessionService.test.ts`
  - [ ] `modules/ai/application/systemPromptService.test.ts`

- [ ] Files Service 测试
  - [ ] 扩展 `modules/files/service.test.ts`
  - [ ] `modules/files/watcher.test.ts`

**目标覆盖率**: 50%

#### 第3周：AI Adapters + Hooks

**任务清单**:

- [ ] OpenAI 适配器测试
  - [ ] `modules/ai/openai/openaiClient.test.ts`
  - [ ] `modules/ai/openai/streaming.test.ts`

- [ ] Dify 适配器测试
  - [ ] `modules/ai/dify/difyClient.test.ts`
  - [ ] `modules/ai/dify/createDifyStreamingClient.test.ts`

- [ ] 核心 Hooks 测试
  - [ ] `hooks/useTabs.test.ts`
  - [ ] `hooks/useFilePersistence.test.ts`
  - [ ] `hooks/useSidebar.test.ts`
  - [ ] `hooks/useOutline.test.ts`

**目标覆盖率**: 60%

---

### 10.3 第三阶段：UI测试 + 集成测试（第4-6周）

#### 第4周：Markdown + Export

**任务清单**:

- [ ] Markdown 渲染测试
  - [ ] `modules/markdown/renderer.test.ts`
  - [ ] `modules/markdown/plugins.test.ts`

- [ ] Export 模块测试
  - [ ] `modules/export/htmlExporter.test.ts`
  - [ ] `modules/export/pdfExporter.test.ts` (如果实现)

#### 第5周：React组件测试

**任务清单**:

- [ ] 核心组件测试
  - [ ] `components/TabBar.test.tsx`
  - [ ] `components/Sidebar.test.tsx`
  - [ ] `components/EditorPane.test.tsx`
  - [ ] `components/PreviewPane.test.tsx`

- [ ] AI UI组件测试
  - [ ] `modules/ai/ui/AiChatDialog.test.tsx`
  - [ ] `components/AiSettingsDialog.test.tsx`

#### 第6周：集成测试

**任务清单**:

- [ ] 文件操作流程测试
  - [ ] `integration/fileOperations.test.ts`

- [ ] AI Chat 流程测试
  - [ ] `integration/aiChat.test.ts`

- [ ] 标签页管理流程测试
  - [ ] `integration/tabManagement.test.ts`

**目标覆盖率**: 70%

---

### 10.4 第四阶段：完善与维护（第7-8周）

#### 第7周：边缘场景 + E2E

**任务清单**:

- [ ] 错误处理测试
  - [ ] 网络错误场景
  - [ ] 文件系统错误场景
  - [ ] AI API 错误场景

- [ ] 性能测试
  - [ ] 大文件处理测试
  - [ ] 长时间运行测试

- [ ] 跨平台兼容性测试

#### 第8周：CI/CD集成 + 文档

**任务清单**:

- [ ] GitHub Actions 配置
  ```yaml
  # .github/workflows/test.yml
  name: Tests
  
  on: [push, pull_request]
  
  jobs:
    test:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: '20'
        - run: npm ci
        - run: npm run test:coverage
        - uses: codecov/codecov-action@v4
  ```

- [ ] 覆盖率徽章集成
- [ ] 测试指南文档完善
- [ ] 贡献指南更新

**目标覆盖率**: 80%

---

## 11. 持续维护策略

### 11.1 代码审查规范

在 Pull Request 中要求：

1. **新功能必须有测试**
   - 新增代码测试覆盖率不低于 80%
   - 提供测试计划和测试用例说明

2. **Bug 修复必须有回归测试**
   - 先编写失败测试用例
   - 修复后确保测试通过

3. **覆盖率检查**
   - CI 自动检查覆盖率是否下降
   - 覆盖率不得低于设定阈值

### 11.2 测试质量指标

| 指标 | 目标值 | 检查方式 |
|------|--------|---------|
| **代码覆盖率** | ≥ 80% | Vitest coverage |
| **测试通过率** | 100% | CI/CD |
| **测试执行时间** | < 30s | Vitest --reporter=verbose |
| **测试维护成本** | 低 | 定期review |

### 11.3 定期维护任务

| 频率 | 任务 |
|------|------|
| **每周** | 检查测试失败用例，修复 flaky tests |
| **每月** | Review 测试覆盖率，补充缺失测试 |
| **每季度** | 更新测试框架版本，优化测试性能 |
| **重大版本** | 全面回归测试，更新测试策略 |

---

## 12. 测试最佳实践

### 12.1 测试命名规范

```typescript
// ✅ 好的命名 - 描述性、清晰
describe('ChatSessionService', () => {
  describe('createSession', () => {
    it('should create new session with given tab ID', () => {})
    it('should throw error if tab ID is empty', () => {})
  })
})

// ❌ 不好的命名 - 模糊、不具体
describe('test', () => {
  it('works', () => {})
})
```

### 12.2 AAA 模式

```typescript
it('should calculate total price with tax', () => {
  // Arrange - 准备测试数据
  const items = [
    { price: 100, quantity: 2 },
    { price: 50, quantity: 1 }
  ]
  const taxRate = 0.1

  // Act - 执行被测试的行为
  const total = calculateTotal(items, taxRate)

  // Assert - 验证结果
  expect(total).toBe(275) // (100*2 + 50*1) * 1.1
})
```

### 12.3 避免测试实现细节

```typescript
// ❌ 测试实现细节 - 脆弱
it('should update state after click', () => {
  const { result } = renderHook(() => useCounter())
  act(() => result.current.increment())
  expect(result.current.internalCount).toBe(1) // 内部状态
})

// ✅ 测试行为 - 稳健
it('should return incremented value after click', () => {
  const { result } = renderHook(() => useCounter())
  act(() => result.current.increment())
  expect(result.current.value).toBe(1) // 公开API
})
```

### 12.4 Mock 使用原则

```typescript
// ✅ Mock 外部依赖
vi.mock('@tauri-apps/api', () => ({
  invoke: vi.fn()
}))

// ✅ 使用工厂函数创建 Mock
function createMockFilePayload(overrides = {}) {
  return {
    path: '/test.md',
    content: '# Test',
    ...overrides
  }
}

// ❌ 不要过度 Mock
vi.mock('./utils', () => ({
  add: vi.fn((a, b) => a + b) // 简单函数不需要 mock
}))
```

### 12.5 异步测试

```typescript
// ✅ 正确处理异步
it('should load data', async () => {
  const { result } = renderHook(() => useData())
  
  await waitFor(() => {
    expect(result.current.data).toBeDefined()
  })
})

// ❌ 忘记 await
it('should load data', () => {
  const { result } = renderHook(() => useData())
  expect(result.current.data).toBeDefined() // 时序问题
})
```

---

## 13. 常见问题与解决方案

### Q1: 测试运行缓慢怎么办？

**解决方案**:
1. 使用并行测试：`vitest.config.ts` 配置 `pool: 'threads'`
2. 优化 Mock，减少不必要的 setup
3. 使用 `test.only` 单独运行慢测试进行优化
4. 考虑拆分测试文件

### Q2: 如何测试 CodeMirror？

**解决方案**:
```typescript
// Mock CodeMirror
vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value, onChange }: any) => (
    <textarea
      data-testid="codemirror-mock"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  )
}))
```

### Q3: 如何测试 Tauri IPC？

**解决方案**:
```typescript
// 在 vitest.setup.ts 中全局 mock
const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api', () => ({
  invoke: mockInvoke,
}))

// 在测试中使用
mockInvoke.mockResolvedValueOnce({ ok: true, data: 'test' })
```

### Q4: 如何测试流式响应？

**解决方案**:
```typescript
it('should handle streaming', async () => {
  const mockStream = async function* () {
    yield 'Hello'
    yield ' World'
  }

  vi.mocked(client.streamChat).mockImplementation(() => mockStream())

  const chunks: string[] = []
  for await (const chunk of client.streamChat('test')) {
    chunks.push(chunk)
  }

  expect(chunks).toEqual(['Hello', ' World'])
})
```

### Q5: 组件测试中如何处理 Context？

**解决方案**:
```typescript
// 创建 wrapper 提供必要的 Context
function createWrapper() {
  return ({ children }: { children: React.ReactNode }) => (
    <AiChatProvider>
      <ThemeProvider>
        {children}
      </ThemeProvider>
    </AiChatProvider>
  )
}

const { result } = renderHook(() => useAiChat(), {
  wrapper: createWrapper()
})
```

---

## 14. 资源与工具

### 14.1 推荐阅读

- [Vitest 官方文档](https://vitest.dev/)
- [Testing Library 文档](https://testing-library.com/)
- [React Testing 最佳实践](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)

### 14.2 工具插件

```json
{
  "devDependencies": {
    "@vitest/ui": "^1.6.1",           // 测试 UI 界面
    "@vitest/coverage-v8": "^1.6.1",  // 覆盖率报告
    "vitest": "^1.6.1"                // 测试框架
  }
}
```

### 14.3 IDE 配置

**VS Code 扩展**:
- Vitest
- Testing Library Snippets

**settings.json**:
```json
{
  "vitest.enable": true,
  "vitest.commandLine": "npm run test"
}
```

---

## 15. 总结

### 15.1 关键成功因素

1. **领导支持** - 测试需要时间投入
2. **团队共识** - 所有人重视测试质量
3. **持续投入** - 不是一次性任务
4. **工具支持** - CI/CD 自动化

### 15.2 预期收益

| 收益 | 说明 |
|------|------|
| **Bug 减少** | 提前发现问题 |
| **重构信心** | 有测试保驾护航 |
| **文档作用** | 测试即文档 |
| **开发效率** | 减少 debug 时间 |
| **代码质量** | 倒逼良好设计 |

### 15.3 下一步行动

1. ✅ 审批本方案
2. ✅ 分配第一阶段任务
3. ✅ 开始基础设施搭建
4. ✅ 每周 Review 进度

---

**文档版本**: v1.0  
**最后更新**: 2026-02-12  
**维护者**: HaoMD 开发团队
