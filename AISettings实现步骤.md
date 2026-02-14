# AI Settings 窗口与快捷键实现方案

本文档设计如何基于现有 Tauri + React 架构，实现 `AI Settings` 设置窗口，并通过原生菜单快捷键触发。实现分为三部分：

1. 后端（Tauri）菜单项与快捷键
2. 前端菜单事件处理与状态管理
3. `AI Settings` 窗口 UI 结构与交互
4. 模型提供商配置的后端存储

---

## 1. 后端：Tauri 原生菜单 + 快捷键

### 1.1 当前菜单结构位置

- 文件：`app/src-tauri/src/lib.rs`
- 函数：`build_app_menu`
- AI 菜单定义片段（当前版本）大致为：

```793:799:app/src-tauri/src/lib.rs
  let ai_menu = SubmenuBuilder::new(app, "AI")
        .item(&MenuItemBuilder::new("Open AI Chat").id("ai_chat").build(app)?)
        .item(&MenuItemBuilder::new("AI Settings").id("ai_settings").build(app)?)
        .item(&MenuItemBuilder::new("Ask AI About File").id("ai_ask_file").build(app)?)
        .item(&MenuItemBuilder::new("Ask AI About Selection").id("ai_ask_selection").build(app)?)
        .build()?;
```

### 1.2 为 AI Settings 添加快捷键（accelerator）

**目标**：通过系统菜单快捷键（例如 `CmdOrCtrl+,`）打开 AI 设置窗口，逻辑与其他菜单项一致。

**修改思路**：

- 在 `AI Settings` 菜单项上添加 `.accelerator("CmdOrCtrl+,")`。
- 仍然使用 `id("ai_settings")`，前端只需识别 `ai_settings` 事件，无需感知快捷键细节。

**示意修改后的片段**（供实现时参考）：

```793:799:app/src-tauri/src/lib.rs
  let ai_menu = SubmenuBuilder::new(app, "AI")
        .item(&MenuItemBuilder::new("Open AI Chat").id("ai_chat").build(app)?)
        .item(&MenuItemBuilder::new("AI Settings").id("ai_settings").accelerator("CmdOrCtrl+,").build(app)?)
        .item(&MenuItemBuilder::new("Ask AI About File").id("ai_ask_file").build(app)?)
        .item(&MenuItemBuilder::new("Ask AI About Selection").id("ai_ask_selection").build(app)?)
        .build()?;
```

> 注意：快捷键的最终选择可以调整，例如 `CmdOrCtrl+Shift+A`，这里用 `CmdOrCtrl+,` 只是示例。

### 1.3 事件通路保持不变

- 文件：`app/src-tauri/src/lib.rs`
- 函数：`run` 中的 `app.on_menu_event`：
  - 对于非 "recent_*"、非剪贴板特例的菜单项，统一执行：

```914:915:app/src-tauri/src/lib.rs
        // 其他菜单统一推送到前端 dispatcher
        let _ = app.emit("menu://action", action.to_string());
```

- 因此，当用户点击菜单或按下快捷键触发 `AI Settings` 时：
  - 后端会通过 `app.emit("menu://action", "ai_settings")` 将事件推给前端。

---

## 2. 前端：菜单事件处理与 AI Settings 状态

### 2.1 现有菜单事件监听

- 文件：`app/src/modules/platform/menuEvents.ts`
- 暴露了一个工具函数 `onMenuAction(handler)` 用于监听 `menu://action`：

```1:16:app/src/modules/platform/menuEvents.ts
export function onMenuAction(handler: (actionId: string) => void | Promise<void>): Unlisten {
  let unlisten: Unlisten | undefined
  let disposed = false

  const setup = async () => {
    const un = await listen<string>('menu://action', (event) => {
      void handler(event.payload)
    })
    if (disposed) {
      un()
    } else {
      unlisten = un
    }
  }

  void setup()

  return () => {
    disposed = true
    if (unlisten) {
      unlisten()
    }
  }
}
```

### 2.2 在前端集中处理 ai_settings 事件

**目标**：在一个全局层面（例如 `App.tsx` 或 `WorkspaceShell` 上层）统一处理菜单事件，并在收到 `ai_settings` 时打开 AI 设置窗口。

**实现要点**：

1. 定义全局状态（例如在 React 根组件）：
   - `const [isAiSettingsOpen, setAiSettingsOpen] = useState(false)`

2. 在顶层组件 `useEffect` 中注册菜单监听：
   - 使用 `onMenuAction`；
   - `actionId === 'ai_settings'` 时，将 `setAiSettingsOpen(true)`；
   - 清理时调用 `unlisten()`。

3. 根据 `isAiSettingsOpen` 渲染 AI 设置弹窗组件：
   - `<AiSettingsDialog open={isAiSettingsOpen} onClose={() => setAiSettingsOpen(false)} />`

> 具体挂载位置可以根据当前架构选择：
> - 若已有一个负责处理菜单动作的模块（如命令分发器 / command registry），可以在其中增加对 `ai_settings` 的分支，并触发一个 UI 状态。

### 2.3 状态与数据模型建议

为了管理多个模型提供商及其模型，建议在前端定义如下数据结构（示意）：

```ts
export type AiProviderModel = {
  id: string        // ModelID，如 "gpt-4.1"
}

export type AiProvider = {
  id: string        // 内部唯一 ID，可用 uuid 或 name+index
  name: string      // Provider Name，如 "OpenAI"
  baseUrl: string
  apiKey: string
  models: AiProviderModel[]
  defaultModelId?: string   // 此 Provider 的默认模型 ID
  description?: string
}

export type AiSettingsState = {
  providers: AiProvider[]
  defaultProviderId?: string
}
```

- 左侧表单用于**录入一个新的 Provider**（或者编辑已有 Provider）。
- 右侧列表仅展示 `AiProvider` 概览，点击展开时显示详情和模型删除操作。
- 全局默认 Provider 和默认模型由 `defaultProviderId` + 对应 Provider 的 `defaultModelId` 决定。

> 持久化建议：后续可通过 Tauri 命令将 `AiSettingsState` 序列化后写入本地配置文件（如 `config_dir/haomd/ai_settings.json`）。本方案文档先聚焦 UI 和事件流程。

---

## 3. AI Settings 窗口 UI 结构与交互

本节基于前面讨论确定的最新版线框：

- 左侧：添加 / 编辑单个 Provider（包含单行 Models 输入）。
- 右侧：折叠的 Provider 列表，默认只展示提供商行，点击展开查看详情和管理模型。

### 3.1 顶层弹窗结构

- 类型：居中的模态对话框（Overlay + 面板）。
- 建议尺寸：宽 800–900px，高 520–600px。

示意结构：

```text
+-----------------------------------------------------------+
| AI Settings                                      [X]      |
+-----------------------------------------------------------+
| 左侧：Add / Edit Provider           | 右侧：Configured Providers |
+-----------------------------------------------------------+
| 左侧表单内容（见 3.2）                                   |
| 右侧折叠列表（见 3.3）                                   |
+-----------------------------------------------------------+
|                                             [Cancel] [Save]|
+-----------------------------------------------------------+
```

### 3.2 左侧：Add / Edit Provider 区域

**UI 布局**：

- `Provider Name`：单行文本框
- `Base URL`：单行文本框
- `API Key`：密码输入 + 显示/隐藏按钮
- `Models`：单行文本框，多个 ModelID 用逗号或空格分隔
- `Paramters`：多行文本框
- 底部按钮：`[ Test & Add Provider ]`、`[ Reset Form ]`

对应 React 组件形态（仅字段结构）：

```ts
function AiProviderForm(props: { onTestAndAdd(providerDraft: ProviderDraft): void; onReset(): void })
```

其中 `ProviderDraft` 可定义为：

```ts
type ProviderDraft = {
  name: string
  baseUrl: string
  apiKey: string
  modelsInput: string  // 比如 "gpt-4.1, gpt-4o-mini text-embedding-3"
  description: string
}
```

**交互步骤（Test & Add Provider）：**

1. 从 `modelsInput` 解析 ModelID 数组：
   - 根据逗号和空白字符拆分；
   - 去掉空字符串；
   - 去重。
2. 使用 `baseUrl + apiKey` 先做一次 Provider 层的连通性测试（轻量请求）。
3. 若 Provider 不可用：
   - 在表单上标记错误，不往右侧列表添加。
4. 若 Provider 可用：
   - 对每个 ModelID 做轻量测试（可并发，但限制并发数量）。
   - 收集成功的 ModelID 列表。
5. 如果没有任何 ModelID 通过测试：
   - 给出错误提示，不添加该 Provider。
6. 如果至少有一个 ModelID 成功：
   - 构造新的 `AiProvider`：
     - `name`、`baseUrl`、`apiKey`、`description` 来自表单；
     - `models` 为成功的 ModelID；
     - `defaultModelId` 默认取第一个成功的 ModelID；
   - 将其追加到 `AiSettingsState.providers` 中；
   - 如果 `defaultProviderId` 为空，则将当前 Provider 设为全局默认；
   - 清空表单（触发 `onReset`）。

> 测试逻辑可抽象到单独的 service 模块，AI Settings 窗口只负责调用和展示结果。

### 3.3 右侧：折叠的 Provider 列表

**折叠状态（默认）**：

```text
[●] OpenAI                    (Default Model: gpt-4.1)        [▶]
[○] DeepSeek                  (Default Model: deepseek-chat)  [▶]
[○] Local LLM                 (Default Model: qwen2.5)        [▶]
```

- `[●]/[○]`：单选按钮，表示是否为全局默认 Provider（对应 `AiSettingsState.defaultProviderId`）。
- 文本显示 Provider 名称和当前默认模型 ID。
- 右侧 `[▶]` / `[▼]`：控制展开和折叠。

**展开状态（展开某个 Provider）**：

```text
[●] OpenAI                    (Default Model: gpt-4.1)        [▼]
    Base URL: https://api.openai.com/v1
    Models:
      - gpt-4.1                     [ Remove ]
      - gpt-4o-mini                 [ Remove ]
      - text-embedding-3            [ Remove ]

    Default Model: [ gpt-4.1 ▾ ]

    [ Edit Provider ]   [ Delete Provider ]
-------------------------------------------------
[○] DeepSeek                  (Default Model: deepseek-chat)  [▶]
[○] Local LLM                 (Default Model: qwen2.5)        [▶]
```

**交互规则**：

1. **删除 Provider**：
   - 点击 `Delete Provider`：从 `providers` 数组中移除该项；
   - 如果删除的是当前 `defaultProviderId`，则：
     - 若还有其他 Provider，自动将第一个 Provider 设为默认；
     - 若没有任何 Provider，清空 `defaultProviderId`。

2. **删除单个模型**：
   - 每行 ModelID 后有 `[ Remove ]`；
   - 点击后，将该模型从 `provider.models` 中移除；
   - 若删除的是当前 `provider.defaultModelId`：
     - 若还有其他模型，将 `defaultModelId` 设为剩余列表第一个；
     - 若没有模型，`defaultModelId` 置为 `undefined`。

3. **切换 Provider 的默认模型**：
   - 使用 `Default Model` 下拉，从 `provider.models` 中选择一个 ModelID；
   - 更新 `provider.defaultModelId`。

4. **选择全局默认 Provider**：
   - 点击行首 `[●]/[○]`：更新 `AiSettingsState.defaultProviderId` 为对应 Provider 的 `id`。

5. **编辑 Provider（可选）**：
   - 点击 `Edit Provider`：将当前 Provider 的数据填充到左侧表单：
     - `Provider Name`、`Base URL`、`API Key`、`Paramters`；
     - 将 `models` 数组合并成单行 `modelsInput`，例如：`"gpt-4.1, gpt-4o-mini, text-embedding-3"`；
   - 用户修改后再次点击 `Test & Add Provider`：
     - 可以选择覆盖原 Provider 或作为新的 Provider 追加（建议提示选择）。

### 3.4 底部按钮与保存策略

- 底部按钮：`[Cancel]`、`[Save]`。

**Cancel 行为**：
- 关闭 AI Settings 窗口；
- 恢复到打开窗口前的 `AiSettingsState`（需要在打开时做一次 state 快照）。

**Save 行为**：
- 校验：
  - 若存在 Provider，但未配置任何模型或 `defaultModelId` 为空，可给出提示；
  - 若设置了 `defaultProviderId`，对应 Provider 应至少有一个模型。
- 校验通过后，将 `AiSettingsState` 提交到：
  - React 上层状态管理；
  - 可选：调用 Tauri 命令持久化到本地配置；
- 关闭窗口。

---

## 4. 模型提供商配置的后端存储

### 4.1 存储位置约定

复用现有最近文件 / 侧边栏状态的存储策略：

- 目录：`app.path().config_dir()/haomd`（例如 macOS 上通常在 `~/Library/Application Support/haomd`）
- 文件名：`ai_settings.json`

最终路径形态：

- `config_dir/haomd/ai_settings.json`

这样可以保证：

- 配置文件不落在源码目录（避免 dev 进程误认为源码变更）；
- 不同用户、不同机器各自维护独立的配置；
- 与 `recent.json`、`sidebar_state.json` 路径风格一致。

### 4.2 Rust 辅助函数设计

在 `app/src-tauri/src/lib.rs` 中，参考 `recent_store_path` / `sidebar_state_path` 的写法，新增：

```rust
fn ai_settings_path(app: &AppHandle) -> std::io::Result<PathBuf> {
  if let Ok(mut dir) = app.path().config_dir() {
    dir.push("haomd");
    std::fs::create_dir_all(&dir)?;
    return Ok(dir.join("ai_settings.json"));
  }

  // 兜底：退回到当前工作目录
  let dir = std::env::current_dir()?;
  Ok(dir.join("ai_settings.json"))
}
```

然后定义用于序列化 / 反序列化的结构（应与前端 `AiSettingsState` 对应）：

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
struct AiProviderModelCfg {
  id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AiProviderCfg {
  id: String,
  name: String,
  base_url: String,
  api_key: String,
  models: Vec<AiProviderModelCfg>,
  #[serde(default)]
  default_model_id: Option<String>,
  #[serde(default)]
  description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AiSettingsCfg {
  providers: Vec<AiProviderCfg>,
  #[serde(default)]
  default_provider_id: Option<String>,
}
```

### 4.3 读写命令（Tauri commands）

新增两个 command：

1. `load_ai_settings`：从 `ai_settings.json` 读取配置
2. `save_ai_settings`：将前端传来的配置写入 `ai_settings.json`

示意实现：

```rust
#[tauri::command]
async fn load_ai_settings(app: AppHandle) -> ResultPayload<AiSettingsCfg> {
  let trace = new_trace_id();
  let path = match ai_settings_path(&app) {
    Ok(p) => p,
    Err(err) => {
      return err_payload(
        ErrorCode::IoError,
        format!("获取 ai_settings 路径失败: {err}"),
        trace,
      )
    }
  };

  match tokio::fs::read(&path).await {
    Ok(bytes) => {
      let cfg: AiSettingsCfg = serde_json::from_slice(&bytes).unwrap_or(AiSettingsCfg {
        providers: Vec::new(),
        default_provider_id: None,
      });
      ok(cfg, trace)
    }
    Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
      // 首次启动：没有文件时返回空配置
      ok(
        AiSettingsCfg {
          providers: Vec::new(),
          default_provider_id: None,
        },
        trace,
      )
    }
    Err(err) => err_payload(
      ErrorCode::IoError,
      format!("读取 ai_settings 失败: {err}"),
      trace,
    ),
  }
}

#[tauri::command]
async fn save_ai_settings(app: AppHandle, cfg: AiSettingsCfg) -> ResultPayload<()> {
  let trace = new_trace_id();
  let path = match ai_settings_path(&app) {
    Ok(p) => p,
    Err(err) => {
      return err_payload(
        ErrorCode::IoError,
        format!("获取 ai_settings 路径失败: {err}"),
        trace,
      )
    }
  };

  let bytes = match serde_json::to_vec_pretty(&cfg) {
    Ok(b) => b,
    Err(err) => {
      return err_payload(
        ErrorCode::IoError,
        format!("序列化 ai_settings 失败: {err}"),
        trace,
      )
    }
  };

  match tokio::fs::write(&path, bytes).await {
    Ok(()) => ok((), trace),
    Err(err) => err_payload(
      ErrorCode::IoError,
      format!("写入 ai_settings 失败: {err}"),
      trace,
    ),
  }
}
```

> 注意：以上代码片段沿用了现有 `ResultPayload` / `ErrorCode` / `ok` / `err_payload` 约定，需要放在同一个模块中，并根据实际泛型签名适配。

最后别忘在 `run()` 的 `invoke_handler` 中注册新命令：

```rust
    .invoke_handler(tauri::generate_handler![
      read_file,
      write_file,
      list_recent,
      log_recent_file,
      clear_recent,
      delete_recent_entry,
      load_sidebar_state,
      save_sidebar_state,
      list_folder,
      set_title,
      delete_fs_entry,
      quit_app,
      load_ai_settings,
      save_ai_settings,
    ])
```

### 4.4 前端与后端存储的对接

在前端：

1. **加载配置**：
   - 应用启动或 AI Settings 打开时，通过 Tauri `invoke('load_ai_settings')` 获取当前配置；
   - 将返回的 `AiSettingsCfg` 转换为前端内部使用的 `AiSettingsState`（字段命名和可选项需要一一对应）。

2. **保存配置**：
   - 用户在 AI Settings 中点击 `Save` 时，将当前的 `AiSettingsState` 映射回 `AiSettingsCfg`；
   - 调用 `invoke('save_ai_settings', { cfg })` 持久化到本地文件。

3. **与实际对话调用集成**：
   - 对话请求模块只需要依赖一个读取好的 `AiSettingsState`：
     - 找到 `defaultProviderId` 对应的 Provider；
     - 取其 `defaultModelId` 作为对话默认模型；
     - 使用 `baseUrl` + `apiKey` 组合出请求客户端。

---

## 5. 实施步骤总结（更新版）

1. **后端（Tauri）菜单快捷键**
   - 在 `build_app_menu` 中为 `AI Settings` 设置 `.accelerator(...)`；
   - 保持 `id("ai_settings")` 和 `menu://action` 事件通路不变。

2. **后端存储：路径与命令**
   - 在 `lib.rs` 中新增 `ai_settings_path`，指向 `config_dir/haomd/ai_settings.json`；
   - 定义 `AiProviderModelCfg`、`AiProviderCfg`、`AiSettingsCfg` 结构；
   - 实现 `load_ai_settings` / `save_ai_settings` 两个 Tauri command；
   - 在 `invoke_handler` 中注册新命令。

3. **前端菜单事件接入**
   - 使用 `onMenuAction` 监听 `menu://action`；
   - 在 `ai_settings` 事件时打开 `AiSettingsDialog`。

4. **前端状态与 UI**
   - 定义 `AiProviderModel`、`AiProvider`、`AiSettingsState` 类型；
   - 实现 `AiSettingsDialog` 及其左右两侧区域（Provider 表单 + Provider 列表）；
   - 实现模型解析、测试、添加、删除、默认 Provider / 默认 Model 切换逻辑。

5. **前端与后端配置同步**
   - 打开时通过 `load_ai_settings` 初始化 `AiSettingsState`；
   - 点击保存时通过 `save_ai_settings` 持久化；
   - 对话调用模块读取当前 `AiSettingsState` 中的默认 Provider + 默认 Model 作为请求参数。
