# ZenMark 项目架构分析与重构计划（SOLID / 高内聚低耦合）

> 目标：在不推翻现有功能的前提下，沿着 SOLID 原则和“高内聚、低耦合”的方向，逐步提升项目可维护性、可扩展性和可测试性。

---

## 1. 当前架构概览（简要）

- **技术栈**：
  - 前端：Vite + React + TypeScript（`app/`）
  - 桌面端：Tauri 2 + Rust（`app/src-tauri/`）
  - Web Chat 子项目：`web-chat/`（独立）
- **前端主要层次**：
  - UI 组件：`components/`（`WorkspaceShell`、`EditorPane`、`PreviewPane`、`Sidebar`、`AiSettingsDialog` 等）
  - 业务 hooks：`hooks/`（`useWorkspaceLayout`、`useFilePersistence`、`useTabs`、`useCommandSystem`、`useSidebar` 等）
  - 领域/服务模块：`modules/files/service.ts`、`modules/sidebar/sidebarStateRepo.ts`、`modules/platform/*`、`modules/ai/settings.ts` 等
  - 领域类型：`types/`、`domain/`
- **后端主要职责**：
  - 文件读写、最近文件、Sidebar 状态、AI Settings 持久化（JSON）
  - 原生菜单（File / Edit / AI）和剪贴板事件，统一通过 `menu://action`、`native://paste` 分发给前端

整体上已经有比较清晰的“UI ↔ hooks ↔ 服务模块 ↔ Tauri 命令”的分层，但在一些关键组件/模块内部仍然存在职责偏多、接口偏粗的问题。

---

## 2. 按 SOLID 和高内聚/低耦合的现状分析

### 2.1 单一职责原则（SRP）

**做得比较好的部分：**

- `modules/files/service.ts`：
  - 负责 Tauri 层文件/最近文件/目录操作的调用与结果映射（`BackendResult` → `Result<T>`）。
  - 与 UI 解耦，属于典型的“服务适配层”。
- `modules/sidebar/sidebarStateRepo.ts`：
  - 集中处理 Sidebar 状态的持久化读写，封装了 `load_sidebar_state` / `save_sidebar_state` 调用。
- `modules/ai/settings.ts`：
  - 专职处理 AI Settings 的前后端映射（`AiSettingsState` ↔ `AiSettingsCfg`）以及默认模型配置的读取。

**存在问题的地方：**

- `WorkspaceShell.tsx`：
  - 同时承担了：
    - 工作区布局管理（layout、拖拽、gridTemplateColumns）；
    - Tab 管理与关闭/退出确认逻辑；
    - 文件持久化状态协调（`useFilePersistence` + tab 路径同步）；
    - Sidebar 打开/删除/上下文菜单行为；
    - 原生菜单事件处理（Open Recent）；
    - 退出确认流程；
    - Debug 日志与全局 click logger。
  - 尽管已拆出多个 hooks，但组件本身依然是“God Component”，SRP 上职责过多。
- `AiSettingsDialog.tsx`：
  - 混合了：
    - UI 结构和交互（表单、Provider 列表、状态切换）；
    - 前后端数据映射（`AiSettingsCfg` ↔ `AiSettingsState`）；
    - 与 Tauri 命令的直接交互（`invoke('load_ai_settings')` / `invoke('save_ai_settings')`）；
    - 粘贴行为（`native://paste`）的订阅与文本插入逻辑；
    - Provider 合并/去重规则。
  - 这些逻辑适合拆分为“视图 + service/hook”，以提高可测试性。
- CSS / 设计：
  - `App.css` 已部分拆分，但仍承担了布局、Modal、通用控件等多类职责，建议进一步模块化后逐步演进为 Design System。

> **SRP 风险**：核心组件过度承担职责，使得任何小改动都容易波及大面积逻辑，测试/理解成本高。

---

### 2.2 开闭原则（OCP）

**已有的良好实践：**

- 命令系统：
  - `modules/commands/registry.ts` + `useCommandSystem`，通过 command id 字符串驱动行为，新增命令只需扩展 registry，而无需修改调用方。
- 文件服务层：
  - `modules/files/service.ts` 把后端的 `ErrorCode` / `ResultPayload` 映射成前端 `Result<T>`，后续新增命令（如 `delete_fs_entry`）时遵循统一模式。
- AI Settings：
  - `AiSettingsState` 结构已支持多 Provider、多 Model，可在不破坏现有 API 下扩展更多 Provider 属性（如限流策略、区域等）。

**不够封闭的地方：**

- AI 相关能力扩展：
  - 当前对话调用（命令 `ai_chat` / `ai_ask_file` / `ai_ask_selection`）只是读取默认 Provider/Model 并打印状态，未来如果接入真实的多种 AI 提供商/协议，缺少统一的“AI Client” 抽象。
  - 建议：引入 `IAiClient` 接口和 Provider 类型枚举，通过配置或工厂注入不同实现，使新增 Provider 不需要修改调用方。
- Markdown 渲染/diagram：
  - 目前代码片段渲染、Mermaid、mind map 等逻辑分布在多个组件/模块中，扩展新类型的 block 时需要修改多处代码，而非只在“渲染注册表”里扩展。

> **OCP 改进方向**：引入更明确的“服务接口”和“注册表/工厂”，让新增能力主要通过“添加实现/配置”而非修改调用逻辑来实现。

---

### 2.3 里氏替换原则（LSP）

当前项目没有大量的继承层次，但从“可替换实现”的角度看：

- **Tauri 依赖的封装较好**：
  - `isTauri()` 判断集中在若干服务模块里，配合 `Result` 类型，让“无 Tauri 环境”时返回一个一致的错误结构（如 `notAvailable`）。
  - 这为未来替换为 Web-only 或添加 Mock 实现提供了基础。
- **尚未显式抽象的可替换点：**
  - 文件系统服务、Sidebar 状态存储、AI 调用等，目前都是直接用具体实现（Tauri 命令），缺少抽象接口。
  - 如要在 Web 端挂载一个“只读 Demo 模式”或接入云端存储，需要能用不同实现替换这些服务，而调用方不感知实现差异。

> **LSP 改进方向**：用接口/类型别名约束“服务边界”，并提供默认实现 + Mock 实现，确保不同实现可以无缝替换而不破坏调用约定。

---

### 2.4 接口隔离原则（ISP）

**现状：**

- `CommandContext` 较为庞大（布局、文件、新建/打开、最近文件、退出、Sidebar、Tab 管理等都在一个上下文里），导致：
  - 某些命令只用其中一小部分字段，但被迫依赖整个 `CommandContext`。
- `WorkspaceShell` 通过多个 hooks 拉取了大量能力（文件、Sidebar、命令系统、剪贴板等），props 和内部状态较重。

**改进思路：**

- 按领域拆分接口：
  - 将 `CommandContext` 拆为多个小接口：
    - `LayoutCommands`（布局相关）；
    - `FileCommands`（打开/保存/最近文件）；
    - `AppLifecycleCommands`（退出/关闭标签）；
  - 然后在 `createCommandRegistry` 里组合这些接口，命令仅依赖自己需要的那一小部分。
- 对 AI 相关能力定义独立接口：
  - 例如 `AiConfigProvider`（读取默认 Provider/Model）、`AiChatService`（发送对话请求），避免 UI 组件直接依赖 `invoke` 或具体实现。

> **ISP 目标**：让调用方只看到自己需要的那一小块能力，避免“大而全”的接口造成不必要耦合。

---

### 2.5 依赖倒置原则（DIP）

**已有的良好示例：**

- 文件服务：
  - UI / hooks 依赖的是前端定义的 `Result<T>`、`FilePayload` 等类型，而不是直接依赖 Tauri 的 `ResultPayload<T>`；
  - `modules/files/service.ts` 才是依赖底层实现（`invoke` + 命令名）的那一层。
- Sidebar 状态与 Recent 文件：
  - 同样通过 repo/service 形式隔离 Tauri 的细节。

**可改进的地方：**

- `AiSettingsDialog` 直接使用 `invoke('load_ai_settings')` / `invoke('save_ai_settings')`，并定义了自己的 `BackendResult` 类型，与 `modules/ai/settings.ts` 的逻辑部分重复：
  - 建议：Dialog 只依赖 `loadAiSettingsState` / `saveAiSettingsState` 等抽象函数；
  - 具体的 `invoke` 调用和 `ResultPayload` 解包只存在于 `modules/ai/settings.ts` 中。
- `WorkspaceShell` 中部分逻辑直接依赖 Tauri：
  - 例如 `invoke('set_title')`、`openDialog`、`invoke('quit_app')` 等，可以进一步下沉到 `modules/platform/*` 服务层，让 shell 只关心“设置标题 / 打开文件 / 退出应用”的语义方法。

> **DIP 方向**：让上层（组件、hook）依赖稳定的接口/抽象类型，而平台特定实现和具体命令名集中在 service 层，避免上层频繁因平台变化而修改。

---

### 2.6 高内聚 & 低耦合、可扩展 & 可维护性综述

- **内聚性总体较好**：
  - 文件服务、Sidebar 状态、AI Settings、菜单/剪贴板事件都已经有相对独立的模块。
- **耦合问题主要集中在：**
  - 大型组件（`WorkspaceShell`、`AiSettingsDialog`）中掺杂了 UI、业务规则、平台交互；
  - 部分“平台适配”逻辑在多个地方重复出现（`isTauriEnv`、`BackendResult`、`ResultPayload` 等映射模式）。
- **可扩展/可维护性隐患：**
  - 新增 AI Provider / 模型时现在仍然要在单一组件内改不少逻辑；
  - 若引入新平台（Web-only、Electron）或新后端服务，对 UI 的影响会较大。

---

## 3. 分阶段重构计划

> 尽量沿用你现有的 `重构.md` 规划，这里从 SOLID 和高内聚/低耦合视角补充“架构向”的分层重构路线。

### Phase 1：统一平台交互与结果封装（DIP / SRP）

**目标**：把所有与 Tauri `invoke` / `ResultPayload` / `BackendResult` 相关的逻辑集中到服务层，UI 只依赖领域接口。

- **任务 1：AI Settings 后端访问下沉到 `modules/ai/settings.ts`**
  - 让 `AiSettingsDialog`：
    - 不再直接 `invoke('load_ai_settings')` / `invoke('save_ai_settings')`；
    - 改为使用 `loadAiSettingsState` / `saveAiSettingsState`；
    - 在 Dialog 内只处理 UI 状态、表单校验、Provider 合并规则。
  - `modules/ai/settings.ts` 负责：
    - `BackendResult<AiSettingsCfg>` 解包；
    - 与后端结构（`AiSettingsCfg`）的映射。

- **任务 2：复用 `BackendResult` / `Result` 处理模式**
  - 当前已有：
    - `modules/files/service.ts` 中的 `BackendResult` 与 `toResult`；
    - `sidebarStateRepo` 中的 `BackendResult`；
    - `modules/ai/settings.ts` 中新引入的 `BackendResult`。
  - 重构目标：
    - 提取公共的 `BackendResult` / `BackendError` / `BackendOk` 类型到 `modules/platform/backendTypes.ts`；
    - 提取 `toResult` / `normalizeInvokeError` 等通用函数，供文件/Sidebar/AI Settings 共享；
    - 避免各模块自行定义重复的 Backend 类型，降低维护成本。

- **任务 3：集中 Tauri 可用性检查**
  - 抽取一个通用工具 `isTauriEnv()` 到 `modules/platform/runtime.ts`；
  - 文件服务、Sidebar repo、AI Settings、WorkspaceShell 等统一使用该工具；
  - 确保非 Tauri 环境下所有调用都返回一致错误，而不是散落的 `if (!isTauri()) return ...`。

> **收益**：更符合 SRP / DIP，未来如果后端返回结构有调整、错误码扩展，只需修改有限几个 service 模块。

---

### Phase 2：组件职责瘦身与 hook 拆分（SRP / ISP / 高内聚）

**目标**：让核心组件（尤其是 `WorkspaceShell` 和 `AiSettingsDialog`）变得“更薄”，把业务规则/平台逻辑下沉到 hooks/服务模块。

- **任务 4：`AiSettingsDialog` 职责拆分**
  - 拆出：
    - `useAiSettingsState`：
      - 管理 `settings` / `initialSnapshot` / `draft` / Provider 合并规则；
      - 对外暴露简洁的 API：`addOrMergeProviderFromDraft`、`deleteProvider`、`setDefaultProvider` 等；
    - `useAiSettingsPersistence`：
      - 只封装 `load` / `save` 两个动作和错误处理；
  - Dialog 组件层只负责：
    - 渲染 UI；
    - 调用上述 hooks 提供的动作；
    - 把错误映射为表单内的信息提示。

- **任务 5：`WorkspaceShell` UI/逻辑再拆分**
  - 在现有 hooks 基础上进一步：
    - 把确认对话框逻辑提取为 `useConfirmDialog` / `useQuitConfirmDialog`；
    - 把 Sidebar 相关逻辑（`openFileFromSidebar`、`openRecentFileInNewTab`、`handleSidebarContextAction`）提取为 `useSidebarActions`；
    - 将全局点击 logger 和 debug 逻辑收敛到开发环境专用 Hook（例如 `useGlobalDebugClickLogger`）。
  - `WorkspaceShell` 主体只负责：
    - 布局拼装（Sidebar / OutlinePanel / 主工作区）；
    - 把 hooks 的返回值和回调绑定到各子组件。

> **收益**：SRP 更清晰，单个 Hook 的职责更聚焦，更易于单元测试和重用。

---

### Phase 3：命令系统与 AI 客户端抽象（OCP / ISP / DIP）

**目标**：让命令系统和 AI 调用能力对“新功能”和“新 Provider”保持开闭，并通过接口隔离减少耦合。

- **任务 6：细化命令上下文接口（ISP）**
  - 将 `CommandContext` 拆分为：
    - `LayoutCommandContext`（布局相关）；
    - `FileCommandContext`（新建/打开/保存/最近文件）；
    - `AppLifecycleCommandContext`（关闭标签/退出）；
    - （可选）`AiCommandContext`（打开 AI Chat / AI Settings / Ask AI）。
  - 在 `createCommandRegistry` 中组合这些小接口；
  - 命令实现只依赖所需上下文类型，避免不必要的耦合。

- **任务 7：定义 AI 客户端接口与实现（OCP / DIP）**
  - 在 `modules/ai` 下新增：
    - `IAiClient` 接口，定义：
      - `sendChat(request): Promise<AiResponse>`；
      - `askAboutFile(path, content, cfg): Promise<AiResponse>` 等方法；
    - `DefaultAiClient` 实现，通过 `DefaultChatConfig`（baseUrl/apiKey/model）访问后端或 Web Chat；
  - 命令系统中的 `ai_chat` / `ai_ask_file` / `ai_ask_selection`：
    - 只依赖 `IAiClient` 接口，不关心底层是 Dify/OpenAI 还是本地服务；
    - 通过工厂或配置选择具体实现，支持未来扩展。

> **收益**：命令系统对新增命令/新 AI Provider 更加封闭，调用方只感知抽象接口，满足 OCP / DIP。

---

### Phase 4：设计体系和 CSS 模块化（高内聚 / 低耦合）

**目标**：进一步提升样式层的可维护性，使 UI 风格统一且可扩展。

- **任务 8：完成 CSS 拆分与 Design Tokens 引入**
  - 在已有 CSS 拆分基础上：
    - 为颜色、阴影、圆角、间距等引入 CSS 变量（design tokens）；
    - 将通用组件样式（按钮、标签、Modal、Sidebar、TabBar 等）整理为一套“基础组件设计语言”。
  - 收紧选择器范围：避免过于宽泛的全局选择器，降低组件间样式互相影响的风险。

> **收益**：提高 UI 一致性和可调性，为后续主题切换/暗黑模式调整等铺路。

---

### Phase 5：可测试性与演进保障（LSP / ISP）

**目标**：为关键逻辑补基础测试，保障未来重构不轻易破坏行为。

- **任务 9：为服务层与关键 Hook 添加单元测试**
  - 优先测试：
    - `modules/files/service.ts` 的 `mapCode` / `toResult` / `normalizeInvokeError`；
    - `modules/ai/settings.ts` 的 `fromCfg` / `toCfg` / `loadDefaultChatConfig`；
    - Provider 合并/去重逻辑（可以从 `AiSettingsDialog` 中抽到纯函数模块再测）。

- **任务 10：为布局与命令系统添加少量行为测试**
  - 对 `useWorkspaceLayout`：
    - 测试不同 layout 下的 `gridTemplateColumns` 计算结果；
  - 对命令系统：
    - 测试 `save` / `open` / `toggle_preview` 等命令对上下文的影响。

> **收益**：通过测试约束接口行为，为后续更激进的重构提供“安全网”，符合 LSP（替换实现不破坏既有契约）。

---

## 4. 总结

- 当前项目已经有比较清晰的分层和部分良好的封装（尤其是文件服务、Sidebar 状态、命令系统基础），但在核心组件和平台适配层仍有职责过多、重复模式的问题。
- 按照上述 Phase 1–5 的顺序，可以逐步：
  - 统一后端结果处理模式；
  - 瘦身 UI 组件、提升内聚；
  - 为命令与 AI 能力引入抽象接口，满足 OCP/DIP；
  - 完善样式体系与测试，提升长期可维护性。
- 后续可以按“按阶段、按任务”地选择具体步骤来实施，例如：
  - “先做 Phase 1 的任务 1–2”，或者
  - “现在执行 Phase 2 的 AiSettingsDialog 拆分”，以迭代方式推进架构演进。
