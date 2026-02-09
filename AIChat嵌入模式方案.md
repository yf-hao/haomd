### AI Chat 嵌入模式实施方案（方案 B）

---

### 1. 背景与设计约束

- **现状**：
  - AI Chat 通过 `AiChatDialog` 以浮动模态窗形式出现，可拖拽。
  - 编辑区布局由 `useWorkspaceLayout` 统一管理，支持：
    - `editor-only` / `preview-only` / `preview-left` / `preview-right`
    - `toggle_preview` 快捷键和菜单。
- **目标**：
  - 保持现有 `toggle preview` 行为与 `useWorkspaceLayout` 逻辑不变。
  - 新增 **“AI Chat 嵌入模式（Docked）”**：
    - 能嵌入在 **最右侧**（Editor/Preview 右边）。
    - 能嵌入在 **最左侧（Sidebar 右侧、编辑器左侧）**。
  - 在 **View 菜单**下新增 “Dock AI Chat” 子菜单：
    - Floating（浮动）
    - Dock Left
    - Dock Right

---

### 2. 模式与状态设计

#### 2.1 模式枚举

在 `WorkspaceShell`（或更高层的 app 状态）中引入以下状态（可按应用范围存储，比如 per-workspace）：

- **`aiChatMode`**：`'floating' | 'docked'`
  - `'floating'`：当前行为，使用模态浮窗。
  - `'docked'`：嵌入到工作区。
- **`aiChatDockSide`**：`'left' | 'right'`
  - `'left'`：嵌入到 Sidebar/Outline 右侧。
  - `'right'`：嵌入到 Editor/Preview 右侧。
- **`aiChatOpen`**：`boolean`
  - 是否在当前 tab 中显示 AI Chat（无论浮动或嵌入）。
  - `aiChatMode === 'floating'` 时，控制 `AiChatDialog` 的打开；
  - `aiChatMode === 'docked'` 时，控制嵌入 pane 的显示。

> 建议：  
> - `aiChatMode` 和 `aiChatDockSide` 作为“视图偏好”，可全局一份。  
> - `aiChatOpen` 和会话状态按 tab 管理（你的会话管理方案里已有设计）。

#### 2.2 行为约定

- **Open AI Chat**（菜单 / 快捷键）：
  - 始终设置当前 tab 的 `aiChatOpen = true`；
  - 根据 `aiChatMode` 决定采用浮动或嵌入。
- **关闭 AI Chat**：
  - 浮动模式：关闭浮窗（`AiChatDialog` 的关闭按钮 / Cmd+W）→ `aiChatOpen = false`；
  - 嵌入模式：嵌入面板顶部的关闭按钮 → `aiChatOpen = false`。
- **切换 Dock 模式**（View 菜单）：
  - **Floating**：
    - `aiChatMode = 'floating'`；
    - 若 `aiChatOpen = true` 且当前是 docked，则隐藏嵌入 pane 并弹出浮动窗。
  - **Dock Left**：
    - `aiChatMode = 'docked'`，`aiChatDockSide = 'left'`；
    - 若 `aiChatOpen = true`，则重新布局，显示左侧嵌入 pane。
  - **Dock Right**：
    - `aiChatMode = 'docked'`，`aiChatDockSide = 'right'`；
    - 若 `aiChatOpen = true`，则重新布局，显示右侧嵌入 pane。

---

### 3. 组件结构重构（浮动 vs 嵌入）

#### 3.1 拆分 AI Chat UI：提取通用内容组件

**目标**：分离“UI 布局壳”和“聊天内容逻辑”，使浮动与嵌入复用同一套内容。

- 在 `app/src/modules/ai/ui` 下新增一个 **通用内容组件**，例如 `AiChatBody`：
  - 只负责：
    - 显示消息列表（使用 `MarkdownViewer`）。
    - 输入框、发送按钮、错误提示。
    - 复制 / 插入 / 替换等操作按钮。
  - 接收的 props 示例：
    - `messages`
    - `loading`
    - `error`
    - `roles`
    - `activeRoleId`
    - `onSend(content: string)`
    - `onChangeRole(roleId: string)`
    - `onCopy(content: string)`
    - `onInsert(content: string)`
    - `onReplace(content: string)`
- `useAiChat` 保持现状，由“容器组件”来调用，并把 `state` 和回调下发给 `AiChatBody`。

#### 3.2 浮动容器：保留 `AiChatDialog` 作为 Floating 版本

- `AiChatDialog` 继续存在，角色调整为 **“浮动容器 + AiChatBody”**：
  - 保留：
    - `.modal-backdrop.modal-backdrop-plain` + `.modal.modal-ai-chat` 外壳。
    - 拖拽相关 state：`dragOffset` / `dragging` / `handleDragStart`。
    - Cmd/Ctrl+W 拦截逻辑。
    - 关闭按钮。
  - 去除与 “嵌入” 冲突的逻辑：
    - 不需要考虑 Dock 状态，只需按照 `open` 决定是否渲染。
  - 内部使用 `<AiChatBody ... />` 作为内容显示区域。

#### 3.3 嵌入容器：新增 `AiChatPane`

- 在 `app/src/modules/ai/ui` 新增组件 `AiChatPane`：
  - 没有 `.modal-backdrop` 和 `transform: translate(...)`；
  - 样式类似其他 `pane`，高度占满父容器；
  - 结构建议：
    - 顶部：标题栏（`AI Chat` + 角色选择 + 关闭按钮）；
    - 中间：消息列表（复用 `messagesContainerRef` 自动滚动逻辑）；
    - 底部：输入区（使用 `AiChatBody` 提供的输入/发送部分）。
  - 同样内部调用 `useAiChat`，把结果传给 `AiChatBody`。
  - 关闭按钮调用上层传入的 `onClose`（通常设置 `aiChatOpen = false`）。

---

### 4. 布局方案 B：嵌入到 Editor/Preview 区域内部

#### 4.1 现有结构简化

当前 `WorkspaceShell` 主体结构简化为：

- 左侧部分：`Sidebar` 或 `OutlinePanel`（宽度由 `sidebarWidth` 控制）。
- 中间：`<main className="workspace">` 内部使用 `gridTemplateColumns` 管理 Editor / Preview 相对位置（通过 `useWorkspaceLayout`）。
- Preview 与 Editor 之间有 `divider-hotzone` 做宽度拖动。

#### 4.2 新增“主内容区内部分栏”（方案 B 核心）

**思路**：  
保持外层布局不变，让 Sidebar / Outline 这一列继续由 `WorkspaceShell` 直接控制。  
在 `<main>` 内，把“Editor+Preview”视为一个整体，再在其左右加一列 `AiChatPane`。

##### 4.2.1 结构建议

在 `WorkspaceShell` 中，重构 `<main>` 内层结构为（示意）：

```tsx
<main className="workspace" style={{ gridTemplateColumns }} ref={workspaceRef}>
  {aiChatMode === 'docked' && aiChatOpen && aiChatDockSide === 'left' && (
    <section className="pane ai-chat-pane">
      <AiChatPane ... />
    </section>
  )}

  <section className="pane-group editor-preview-group">
    {/* 这里仍然使用 useWorkspaceLayout 的逻辑来渲染 Editor + Preview + divider-hotzone */}
  </section>

  {aiChatMode === 'docked' && aiChatOpen && aiChatDockSide === 'right' && (
    <section className="pane ai-chat-pane">
      <AiChatPane ... />
    </section>
  )}
</main>
```

核心点：

- **`editor-preview-group` 内部完全沿用现在的 `useWorkspaceLayout` 逻辑**：
  - `effectiveLayout`（`preview-left` / `preview-right` / `editor-only` / `preview-only`）
  - `previewWidthForRender`
  - `divider-hotzone` 的拖拽行为
- AI Chat Pane 作为 `main` 的左右额外列，不参与 `useWorkspaceLayout` 的计算。
- `main` 的 `gridTemplateColumns` 可以扩展为：
  - 无 AI Chat 时：`1fr`（即只有 `editor-preview-group`）
  - 左 Dock：`[aiChatWidth] [editorPreviewWidth]`
  - 右 Dock：`[editorPreviewWidth] [aiChatWidth]`
- `aiChatWidth` 可以：
  - 初始设为固定 px（如 `320px`），
  - 或设为百分比（如工作区宽度的 30%），后续可扩展支持拖动。

##### 4.2.2 宽度与样式

- 在 CSS 中新增用于嵌入模式的 class：
  - `.ai-chat-pane`：设置背景、边框、内部滚动等。
  - `.editor-preview-group`：包裹现有 Editor/Preview 面板，保持原来的 `.pane` 样式逻辑。
- 若未来希望 AI Chat 宽度可拖动：
  - 可以参考 Preview 的 `divider-hotzone` 设计，再加一个 Docked Chat 专用的垂直拖拽条。

---

### 5. View 菜单：Dock AI Chat 子菜单设计

#### 5.1 Tauri 菜单结构调整

在 `app/src-tauri/src/lib.rs` 中，View 菜单下新增一个子菜单 “Dock AI Chat”：

- View
  - Toggle Preview
  - ...
  - **Dock AI Chat**
    - Floating（`view_ai_chat_floating`）
    - Dock Left（`view_ai_chat_dock_left`）
    - Dock Right（`view_ai_chat_dock_right`）

注意事项：

- 每个子菜单项分配唯一 `id`（如上）。
- 选择其中一项时，只需发出对应的菜单事件（你现有的 `onMenuAction` 会把 `id` 传入前端）。

#### 5.2 命令注册与实现

在 `app/src/modules/commands/registry.ts` 中：

- 新增 View 相关命令（可以放在布局命令组或单独新增一个 `createViewCommands`）：

  - `view_ai_chat_floating`
    - 设置：
      - `aiChatMode = 'floating'`
      - 保持 `aiChatDockSide` 不变（以便用户切回 docked 模式时还记得位置）。
      - 如果 `aiChatOpen` 为 true，则：
        - 关闭 docked UI（即不再渲染 `AiChatPane`）；
        - 打开浮动 `AiChatDialog`（通过 `openAiChatDialog`）。
  - `view_ai_chat_dock_left`
    - 设置：
      - `aiChatMode = 'docked'`
      - `aiChatDockSide = 'left'`
    - 若当前 `aiChatOpen` 为 true，则重新布局（显示左侧 pane）。
  - `view_ai_chat_dock_right`
    - 同理，将 `aiChatDockSide` 设为 `'right'`。

- 上述命令需要 `CommandContext` 中新增/扩展以下字段（通过 `useCommandSystem` 传入）：
  - `aiChatMode`、`aiChatDockSide`、`aiChatOpen` 及其 setter（可以集中封装为一个 `setAiChatLayout` 回调，避免在命令中直接操作 React state 细节）。
  - 或者更简单：暴露一个 `setAiChatLayout({ mode, dockSide, ensureOpen? })` 高级接口，由 `WorkspaceShell` 负责具体 state 更新。

#### 5.3 前端菜单事件分发

在 `app/src/hooks/useCommandSystem.ts` 中：

- 保持对 `onMenuAction` 的监听：
  - 当收到 `view_ai_chat_floating` / `view_ai_chat_dock_left` / `view_ai_chat_dock_right` 时，调用对应命令。
- 将新命令加入 `dispatchAction` 的可识别范围（本质上是把它加到 `createCommandRegistry` 返回的对象中）。

---

### 6. 分步实施清单

可按这个顺序落地：

1. **拆分 AI Chat 内容组件**：
   - 从 `AiChatDialog` 中抽出 `AiChatBody`，确保不依赖模态/拖拽，只处理内容和交互。
   - 调整 `AiChatDialog` 为“浮动容器 + AiChatBody”。

2. **实现嵌入容器 `AiChatPane`**：
   - 新增组件，内部使用 `useAiChat` + `AiChatBody`。
   - 添加标题栏（带关闭按钮 + 角色选择），高度占满父容器。

3. **在 `WorkspaceShell` 中新增 AI Chat 视图状态**：
   - `aiChatMode: 'floating' | 'docked'`
   - `aiChatDockSide: 'left' | 'right'`
   - `aiChatOpen: boolean`（或沿用现有 `aiChatState` 结构，增加 mode/dockSide 相关逻辑）。
   - 调整 `openAiChatDialog` / `closeAiChatDialog` 行为：
     - 浮动模式：打开/关闭 `AiChatDialog`。
     - 嵌入模式：只控制 `aiChatOpen`。

4. **重构 `<main>` 内部布局（方案 B）**：
   - 把 Editor + Preview 的现有代码抽成 `EditorPreviewGroup` 块；
   - 在其左右插入 `AiChatPane` 对应的 `section`，根据 `aiChatMode` / `aiChatDockSide` / `aiChatOpen` 决定是否渲染；
   - 更新 `gridTemplateColumns` 以容纳额外一列。

5. **修改 View 菜单（Tauri 端）**：
   - 在 `lib.rs` 中添加 View → “Dock AI Chat” 子菜单及三个命令 id。

6. **在命令系统中注册 Dock 命令**：
   - 在 `registry.ts` 中新增 `view_ai_chat_floating` / `view_ai_chat_dock_left` / `view_ai_chat_dock_right` 命令；
   - 在 `useCommandSystem` 中把这些命令加入 `commands`，并通过 `onMenuAction` 分发。

7. **整体联调 & 打磨 UX**：
   - 验证：
     - 浮动/嵌入模式之间切换是否平滑；
     - 左/右 dock 时 `toggle preview` 是否仍然按预期工作；
     - 关闭 AI Chat 后再次打开是否位置稳定、不再“瞬移”。
