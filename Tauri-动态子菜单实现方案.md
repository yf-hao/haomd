# Tauri 动态子菜单实现方案

## 1. 方案概述

Tauri 的原生菜单需要在 Rust 端构建，**无法直接在前端"模拟"原生子菜单**。但可以通过以下方案实现动态子菜单效果。

---

## 2. 当前项目实现（Open Recent）

### 2.1 核心流程

```
前端调用/触发 → Rust 重新构建菜单 → app.set_menu() 刷新
```

### 2.2 Rust 端代码（lib.rs）

#### 构建动态子菜单

```rust
// 定义全局状态存储
static RECENT_MENU_MAP: Lazy<std::sync::Mutex<HashMap<String, String>>> =
  Lazy::new(|| std::sync::Mutex::new(HashMap::new()));

static RECENT_PAGE: Lazy<std::sync::Mutex<u32>> =
  Lazy::new(|| std::sync::Mutex::new(0));

const RECENT_MENU_PREFIX: &str = "recent_item_";

// 构建动态子菜单
async fn build_app_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
  let mut recent = read_recent_store(app).await.unwrap_or_default();
  recent.sort_by(|a, b| b.last_opened_at.cmp(&a.last_opened_at));

  let total = recent.len();
  let page_size = RECENT_PAGE_SIZE as u32;
  let current_page = *RECENT_PAGE.lock().unwrap();

  // 计算分页
  let start = (current_page * page_size) as usize;
  let end = ((current_page + 1) * page_size) as usize;
  let slice = &recent[start..std::cmp::min(end, total)];

  // 构建 Open Recent 子菜单
  let mut open_recent_builder = SubmenuBuilder::new(app, "Open Recent");
  {
    let mut map = RECENT_MENU_MAP.lock().unwrap();
    map.clear();

    // 动态添加菜单项
    for (idx, item) in slice.iter().enumerate() {
      let id = format!("{RECENT_MENU_PREFIX}{idx}");
      map.insert(id.clone(), item.path.clone());

      let label = format_recent_menu_label(item);
      open_recent_builder = open_recent_builder.item(
        &MenuItemBuilder::new(&label)
          .id(&id)
          .build(app)?,
      );
    }
  }

  // 添加分页控制
  if max_page > 0 {
    open_recent_builder = open_recent_builder
      .separator()
      .item(&MenuItemBuilder::new("Previous Page").id("recent_prev_page").build(app)?)
      .item(&MenuItemBuilder::new("Next Page").id("recent_next_page").build(app)?);
  }

  let open_recent_menu = open_recent_builder.build()?;

  // 组装完整菜单
  let file_menu = SubmenuBuilder::new(app, "File")
    .item(&MenuItemBuilder::new("New").id("new_file").build(app)?)
    .item(&open_recent_menu)  // 嵌入动态子菜单
    .build()?;

  let menu = MenuBuilder::new(app)
    .item(&file_menu)
    .build()?;

  Ok(menu)
}
```

#### 菜单刷新函数

```rust
async fn refresh_app_menu(app: &AppHandle) {
  if let Ok(menu) = build_app_menu(app).await {
    let _ = app.set_menu(menu);  // 关键：重新设置菜单
  }
}
```

#### 菜单事件处理

```rust
app.on_menu_event(|app, event| {
  let action = event.id().as_ref();

  // 处理动态菜单项点击
  if action.starts_with(RECENT_MENU_PREFIX) {
    let path_opt = {
      let map = RECENT_MENU_MAP.lock().unwrap();
      map.get(action).cloned()
    };
    if let Some(path) = path_opt {
      let _ = app.emit("menu://open_recent_file", path);
    }
    return;
  }

  // 处理分页按钮
  if action == "recent_prev_page" || action == "recent_next_page" {
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
      // 更新页码状态
      {
        let mut page = RECENT_PAGE.lock().unwrap();
        if action == "recent_prev_page" && *page > 0 {
          *page -= 1;
        } else if action == "recent_next_page" {
          *page += 1;
        }
      }
      // 刷新菜单
      refresh_app_menu(&app_handle).await;
    });
    return;
  }

  // 其他菜单事件统一转发
  let _ = app.emit("menu://action", action.to_string());
});
```

### 2.3 前端代码（menuEvents.ts）

```typescript
import { listen } from '@tauri-apps/api/event'

export type Unlisten = () => void

/**
 * 监听 Tauri 原生菜单命令（menu://action）
 */
export function onMenuAction(handler: (actionId: string) => void): Unlisten {
  let unlisten: Unlisten | undefined

  const setup = async () => {
    const un = await listen<string>('menu://action', (event) => {
      void handler(event.payload)
    })
    unlisten = un
  }

  void setup()

  return () => {
    if (unlisten) {
      unlisten()
    }
  }
}

/**
 * 监听 Open Recent 子菜单点击
 */
export function onOpenRecentFile(handler: (path: string) => void): Unlisten {
  let unlisten: Unlisten | undefined

  const setup = async () => {
    const un = await listen<string>('menu://open_recent_file', (event) => {
      void handler(event.payload)
    })
    unlisten = un
  }

  void setup()

  return () => {
    if (unlisten) {
      unlisten()
    }
  }
}
```

### 2.4 使用示例

```typescript
import { useEffect } from 'react'
import { onMenuAction, onOpenRecentFile } from './menuEvents'
import { invoke } from '@tauri-apps/api/core'

function App() {
  useEffect(() => {
    // 监听普通菜单事件
    const unlistenAction = onMenuAction((actionId) => {
      switch (actionId) {
        case 'new_file':
          handleNewFile()
          break
        case 'save':
          handleSave()
          break
        // ...
      }
    })

    // 监听最近文件点击
    const unlistenRecent = onOpenRecentFile((path) => {
      openFile(path)
    })

    return () => {
      unlistenAction()
      unlistenRecent()
    }
  }, [])
}

// 触发菜单刷新（如文件打开后）
async function logRecentFile(path: string) {
  await invoke('log_recent_file', { path, isFolder: false })
  // Rust 端会自动调用 refresh_app_menu
}
```

---

## 3. 可选方案对比

### 方案 A：Rust 动态刷新（推荐）

| 维度 | 说明 |
|------|------|
| **适用场景** | 最近文件列表、AI 模型列表、历史记录等 |
| **实现复杂度** | 中等 |
| **用户体验** | 原生体验，菜单完全集成到系统 |
| **刷新时机** | 数据变化时调用 `refresh_app_menu` |

**优点：**
- 完全原生的系统菜单体验
- 支持键盘快捷键
- 与其他 macOS/Windows 应用一致

**缺点：**
- 菜单刷新有轻微闪烁（重建整个菜单）
- 无法实现搜索、筛选等复杂交互

### 方案 B：前端组件模拟

| 维度 | 说明 |
|------|------|
| **适用场景** | 需要搜索/筛选、复杂交互的场景 |
| **实现复杂度** | 低 |
| **用户体验** | Web 风格，非原生 |

**实现方式：**

```typescript
// 1. 原生菜单只提供一个入口
// Menu: AI → Select Model

// 2. 点击后打开前端自定义 Dropdown/Popover
function handleMenuAction(actionId: string) {
  if (actionId === 'ai_select_model') {
    // 显示前端组件
    setShowModelSelector(true)
  }
}
```

**优点：**
- 可以实现搜索、分组、图标等丰富效果
- 无需 Rust 端改动

**缺点：**
- 非原生体验
- 需要手动处理焦点、键盘导航

### 方案 C：混合方案（推荐用于复杂场景）

| 维度 | 说明 |
|------|------|
| **适用场景** | AI 配置、Prompt 选择等配置项较多的场景 |
| **实现复杂度** | 中等 |
| **用户体验** | 点击菜单打开专用对话框 |

**实现方式：**

```typescript
// 原生菜单
// AI → Provider Settings (Cmd+,)
// AI → Prompt Settings
// AI → Select Role → [静态子菜单：Developer / Writer / Custom...]

// 点击后打开对话框
function handleMenuAction(actionId: string) {
  switch (actionId) {
    case 'ai_settings':
      setShowSettingsDialog(true)
      break
    case 'ai_prompt_settings':
      setShowPromptDialog(true)
      break
    case 'ai_role_developer':
      setActiveRole('developer')
      break
  }
}
```

**优点：**
- 常用选项快速访问（静态子菜单）
- 复杂配置通过对话框处理
- 兼顾效率与功能

---

## 4. 具体实现示例：AI 模型选择子菜单

### 4.1 Rust 端新增代码

```rust
// 存储当前 AI 配置状态
static AI_SETTINGS_CACHE: Lazy<Mutex<Option<AiSettingsCfg>>> = 
  Lazy::new(|| Mutex::new(None));

// 构建 AI 模型子菜单
async fn build_ai_models_submenu(app: &AppHandle) -> tauri::Result<Submenu<tauri::Wry>> {
  let cfg = AI_SETTINGS_CACHE.lock().await.clone();
  
  let mut builder = SubmenuBuilder::new(app, "Select Model");
  
  if let Some(settings) = cfg {
    for provider in &settings.providers {
      if provider.models.is_empty() {
        continue;
      }
      
      // 每个 provider 一个子菜单
      let mut provider_builder = SubmenuBuilder::new(app, &provider.name);
      
      for model in &provider.models {
        let id = format!("ai_model_{}_{}", provider.id, model.id);
        let label = format!("{} ({})", model.id, provider.name);
        
        provider_builder = provider_builder.item(
          &MenuItemBuilder::new(&label)
            .id(&id)
            .build(app)?,
        );
      }
      
      builder = builder.item(&provider_builder.build()?);
    }
  }
  
  builder.build()
}

// 暴露给前端的刷新命令
#[tauri::command]
async fn refresh_ai_menu(app: AppHandle) -> Result<(), String> {
  // 读取最新配置
  let cfg = load_ai_settings(app.clone()).await;
  if let ResultPayload::Ok { data, .. } = cfg {
    *AI_SETTINGS_CACHE.lock().await = Some(data);
  }
  
  // 刷新整个菜单
  refresh_app_menu(&app).await;
  Ok(())
}
```

### 4.2 前端调用

```typescript
import { invoke } from '@tauri-apps/api/core'

// 保存 AI 设置后刷新菜单
async function saveAiSettings(settings: AiSettings) {
  await invoke('save_ai_settings', { cfg: settings })
  // 触发菜单刷新
  await invoke('refresh_ai_menu')
}
```

---

## 5. 关键注意事项

### 5.1 菜单 ID 命名规范

```rust
// 推荐格式：模块_动作_标识
"new_file"           // 简单动作
"recent_item_0"      // 带索引的动态项
"ai_model_dify_gpt4" // 组合标识
"layout_preview_left" // 嵌套功能
```

### 5.2 状态管理

```rust
// 使用全局 Lazy 存储临时状态
static MENU_STATE: Lazy<Mutex<MenuState>> = 
  Lazy::new(|| Mutex::new(MenuState::default()));

// 点击时从状态查找对应数据
if action.starts_with("recent_item_") {
  let state = MENU_STATE.lock().await;
  if let Some(data) = state.get(action) {
    // 处理点击
  }
}
```

### 5.3 性能优化

```rust
// 1. 避免频繁刷新
fn debounce_refresh(app: &AppHandle) {
  // 使用定时器防抖
}

// 2. 增量更新（Tauri v2 未来可能支持）
// 目前只能重建整个菜单
```

### 5.4 平台差异

| 平台 | 注意事项 |
|------|----------|
| macOS | 第一个菜单项必须是应用名（HaoMD） |
| Windows | 支持 `&` 快捷键前缀（如 `&File`） |
| Linux | 部分桌面环境可能不支持某些菜单特性 |

---

## 6. 总结

| 需求 | 推荐方案 |
|------|----------|
| 最近文件、历史记录 | **方案 A** Rust 动态刷新 |
| 需要搜索/筛选的模型列表 | **方案 B** 前端组件 |
| 复杂配置（AI Settings） | **方案 C** 混合方案 |
| 快速切换的选项 | 静态子菜单 + 事件监听 |

当前项目已实现的 **Open Recent** 是方案 A 的最佳实践参考。
