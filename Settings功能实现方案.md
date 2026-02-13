# Settings 功能实现方案

**创建日期**: 2026-02-12

---

## 1. 功能概述

在 HaoMD 菜单下添加 Settings 菜单项，点击后打开设置对话框，支持配置：

- **外观**: 主题、字体大小、字体族、行高
- **语言**: 界面语言、拼写检查语言
- **图像**: 默认格式、压缩质量、最大宽度、保存目录
- **输出**: PDF纸张大小、页边距、HTML内联样式、Mermaid导出选项

---

## 2. 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                       Settings 架构                              │
├─────────────────────────────────────────────────────────────────┤
│  Rust 端 (Tauri)                                                │
│  ├── 添加 Settings 菜单项到 HaoMD 菜单                          │
│  ├── 定义 AppSettings 结构体                                    │
│  ├── load_app_settings / save_app_settings 命令                 │
│  └── settings.json 持久化                                       │
├─────────────────────────────────────────────────────────────────┤
│  前端 (React + TypeScript)                                      │
│  ├── types/settings.ts          # 类型定义                      │
│  ├── hooks/useAppSettings.ts    # 设置状态管理                  │
│  ├── hooks/useTheme.ts          # 主题切换逻辑                  │
│  ├── components/SettingsDialog.tsx # 设置对话框                 │
│  ├── components/SettingsDialog.css # 对话框样式                 │
│  ├── modules/commands/registry.ts # 注册 open_settings 命令     │
│  └── styles/themes.css          # 主题 CSS 变量                 │
└─────────────────────────────────────────────────────────────────┘
```

### 设置对话框布局

```
┌─────────────────────────────────────────────────────────────────┐
│  Settings                                                 [X]  │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌─────────────────────────────────────────────┐ │
│  │ 🎨 外观  │  │  外观设置                                    │ │
│  │ 🌐 语言  │  │  ─────────────────────────────────────────  │ │
│  │ 🖼️ 图像  │  │  主题: [☀️浅色] [🌙深色] [💻跟随系统]        │ │
│  │ 📄 输出  │  │  字体大小: [─────●───] 14px                 │ │
│  │          │  │  字体族: [Inter ▼]                          │ │
│  │          │  │  行高: [─────●───] 1.6                      │ │
│  └──────────┘  └─────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│                                            [关闭]               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 数据模型

### 3.1 Rust 结构体定义

**文件**: `app/src-tauri/src/lib.rs`

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
  /// 外观设置
  pub appearance: AppearanceSettings,
  /// 语言设置
  pub language: LanguageSettings,
  /// 图像设置
  pub image: ImageSettings,
  /// 输出设置
  pub output: OutputSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppearanceSettings {
  /// 主题: dark | light | system
  pub theme: String,
  /// 字体大小
  pub font_size: u32,
  /// 字体族
  pub font_family: String,
  /// 行高
  pub line_height: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LanguageSettings {
  /// 界面语言: zh-CN | en-US
  pub ui_language: String,
  /// 拼写检查语言
  pub spell_check_language: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageSettings {
  /// 图片默认保存格式: png | jpg | webp
  pub default_format: String,
  /// 图片压缩质量 (1-100)
  pub quality: u32,
  /// 图片最大宽度 (px)，超过则缩放
  pub max_width: u32,
  /// 图片保存目录 (相对于文档)
  pub save_directory: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputSettings {
  /// 导出 PDF 默认纸张大小: A4 | A3 | Letter
  pub pdf_paper_size: String,
  /// 导出 PDF 页边距
  pub pdf_margin: f32,
  /// 导出 HTML 是否内联样式
  pub html_inline_styles: bool,
  /// 导出时是否包含 Mermaid 图表渲染结果
  pub export_rendered_mermaid: bool,
}

impl Default for AppSettings {
  fn default() -> Self {
    Self {
      appearance: AppearanceSettings {
        theme: "dark".to_string(),
        font_size: 14,
        font_family: "Inter".to_string(),
        line_height: 1.6,
      },
      language: LanguageSettings {
        ui_language: "zh-CN".to_string(),
        spell_check_language: Some("zh-CN".to_string()),
      },
      image: ImageSettings {
        default_format: "png".to_string(),
        quality: 85,
        max_width: 1920,
        save_directory: "images".to_string(),
      },
      output: OutputSettings {
        pdf_paper_size: "A4".to_string(),
        pdf_margin: 20.0,
        html_inline_styles: true,
        export_rendered_mermaid: true,
      },
    }
  }
}
```

### 3.2 TypeScript 类型定义

**新建文件**: `app/src/types/settings.ts`

```typescript
export type Theme = 'dark' | 'light' | 'system'
export type UiLanguage = 'zh-CN' | 'en-US'
export type ImageFormat = 'png' | 'jpg' | 'webp'
export type PdfPaperSize = 'A4' | 'A3' | 'Letter'

export interface AppearanceSettings {
  theme: Theme
  fontSize: number
  fontFamily: string
  lineHeight: number
}

export interface LanguageSettings {
  uiLanguage: UiLanguage
  spellCheckLanguage: string | null
}

export interface ImageSettings {
  defaultFormat: ImageFormat
  quality: number
  maxWidth: number
  saveDirectory: string
}

export interface OutputSettings {
  pdfPaperSize: PdfPaperSize
  pdfMargin: number
  htmlInlineStyles: boolean
  exportRenderedMermaid: boolean
}

export interface AppSettings {
  appearance: AppearanceSettings
  language: LanguageSettings
  image: ImageSettings
  output: OutputSettings
}
```

---

## 4. 实现步骤

### 步骤 1: 修改 Rust 端菜单定义

**文件**: `app/src-tauri/src/lib.rs`

**位置**: 约第 781-785 行，修改 HaoMD 菜单

```rust
// 修改前
let haomd_menu = SubmenuBuilder::new(app, "HaoMD")
  .item(&MenuItemBuilder::new("About HaoMD").id("haomd_about").build(app)?)
  .item(&MenuItemBuilder::new("Quit").id("quit").accelerator("CmdOrCtrl+Q").build(app)?)
  .build()?;

// 修改后
let haomd_menu = SubmenuBuilder::new(app, "HaoMD")
  .item(&MenuItemBuilder::new("About HaoMD").id("haomd_about").build(app)?)
  .separator()
  .item(&MenuItemBuilder::new("Settings").id("open_settings").accelerator("CmdOrCtrl+,").build(app)?)
  .separator()
  .item(&MenuItemBuilder::new("Quit").id("quit").accelerator("CmdOrCtrl+Q").build(app)?)
  .build()?;
```

---

### 步骤 2: 添加 Rust 持久化命令

**文件**: `app/src-tauri/src/lib.rs`

**2.1 添加设置文件路径函数**

```rust
// 添加在 ai_settings_path 函数附近
fn app_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app
    .app_data_dir()
    .map_err(|e| format!("获取应用数据目录失败: {e}"))?;
  Ok(dir.join("settings.json"))
}
```

**2.2 添加加载命令**

```rust
#[tauri::command]
async fn load_app_settings(app: AppHandle) -> ResultPayload<AppSettings> {
  let trace = new_trace_id();
  let path = match app_settings_path(&app) {
    Ok(p) => p,
    Err(err) => {
      return err_payload(ErrorCode::IoError, err, trace);
    }
  };

  match fs::read(&path).await {
    Ok(bytes) => {
      let settings: AppSettings = serde_json::from_slice(&bytes).unwrap_or_default();
      ok(settings, trace)
    }
    Err(_) => {
      // 文件不存在时返回默认值
      ok(AppSettings::default(), trace)
    }
  }
}
```

**2.3 添加保存命令**

```rust
#[tauri::command]
async fn save_app_settings(app: AppHandle, settings: AppSettings) -> ResultPayload<()> {
  let trace = new_trace_id();
  let path = match app_settings_path(&app) {
    Ok(p) => p,
    Err(err) => {
      return err_payload(ErrorCode::IoError, err, trace);
    }
  };

  let json = serde_json::to_string_pretty(&settings)
    .map_err(|e| format!("序列化设置失败: {e}"))
    .unwrap_or_default();

  match fs::write(&path, &json).await {
    Ok(_) => ok((), trace),
    Err(err) => err_payload(ErrorCode::IoError, format!("保存设置失败: {err}"), trace),
  }
}
```

**2.4 注册命令**

```rust
// 在 invoke_handler 中添加
.invoke_handler(tauri::generate_handler![
  // ... 现有命令 ...
  load_app_settings,
  save_app_settings,
])
```

---

### 步骤 3: 创建类型定义文件

**新建文件**: `app/src/types/settings.ts`

内容见上文 [3.2 TypeScript 类型定义](#32-typescript-类型定义)

---

### 步骤 4: 创建设置管理 Hook

**新建文件**: `app/src/hooks/useAppSettings.ts`

```typescript
import { useState, useCallback } from 'react'
import type { AppSettings } from '../types/settings'

const DEFAULT_SETTINGS: AppSettings = {
  appearance: {
    theme: 'dark',
    fontSize: 14,
    fontFamily: 'Inter',
    lineHeight: 1.6,
  },
  language: {
    uiLanguage: 'zh-CN',
    spellCheckLanguage: 'zh-CN',
  },
  image: {
    defaultFormat: 'png',
    quality: 85,
    maxWidth: 1920,
    saveDirectory: 'images',
  },
  output: {
    pdfPaperSize: 'A4',
    pdfMargin: 20,
    htmlInlineStyles: true,
    exportRenderedMermaid: true,
  },
}

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)

  // 从后端加载
  const load = useCallback(async (): Promise<AppSettings> => {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const result = await invoke<{ ok: boolean; data?: AppSettings }>('load_app_settings')
      if (result.ok && result.data) {
        setSettings(result.data)
        setLoaded(true)
        return result.data
      }
    } catch (err) {
      console.warn('[useAppSettings] load failed:', err)
    }
    setLoaded(true)
    return DEFAULT_SETTINGS
  }, [])

  // 保存到后端
  const save = useCallback(async (newSettings: AppSettings) => {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('save_app_settings', { settings: newSettings })
      setSettings(newSettings)
    } catch (err) {
      console.error('[useAppSettings] save failed:', err)
    }
  }, [])

  // 更新某个分类下的某个字段
  const update = useCallback(<K extends keyof AppSettings>(
    category: K,
    key: keyof AppSettings[K],
    value: AppSettings[K][keyof AppSettings[K]]
  ) => {
    setSettings((prev) => {
      const newSettings = {
        ...prev,
        [category]: {
          ...prev[category],
          [key]: value,
        },
      }
      save(newSettings)
      return newSettings
    })
  }, [save])

  return {
    settings,
    loaded,
    load,
    save,
    update,
  }
}
```

---

### 步骤 5: 创建主题管理 Hook

**新建文件**: `app/src/hooks/useTheme.ts`

```typescript
import { useEffect, useCallback } from 'react'
import type { Theme } from '../types/settings'

export function useTheme(theme: Theme) {
  // 解析实际主题（处理 system 选项）
  const resolveTheme = useCallback((t: Theme): 'dark' | 'light' => {
    if (t === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return t
  }, [])

  // 应用主题到 DOM
  useEffect(() => {
    const resolved = resolveTheme(theme)
    document.documentElement.setAttribute('data-theme', resolved)
  }, [theme, resolveTheme])

  // 监听系统主题变化（当 theme === 'system' 时）
  useEffect(() => {
    if (theme !== 'system') return

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      const resolved = mq.matches ? 'dark' : 'light'
      document.documentElement.setAttribute('data-theme', resolved)
    }

    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])
}
```

---

### 步骤 6: 创建设置对话框组件

**新建文件**: `app/src/components/SettingsDialog.tsx`

```tsx
import { useState } from 'react'
import type { FC } from 'react'
import type { AppSettings, Theme, UiLanguage, ImageFormat, PdfPaperSize } from '../types/settings'
import './SettingsDialog.css'

type SettingsTab = 'appearance' | 'language' | 'image' | 'output'

export type SettingsDialogProps = {
  open: boolean
  onClose: () => void
  settings: AppSettings
  onUpdate: <K extends keyof AppSettings>(
    category: K,
    key: keyof AppSettings[K],
    value: AppSettings[K][keyof AppSettings[K]]
  ) => void
}

export const SettingsDialog: FC<SettingsDialogProps> = ({
  open,
  onClose,
  settings,
  onUpdate,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance')

  if (!open) return null

  const tabs: { id: SettingsTab; label: string; icon: string }[] = [
    { id: 'appearance', label: '外观', icon: '🎨' },
    { id: 'language', label: '语言', icon: '🌐' },
    { id: 'image', label: '图像', icon: '🖼️' },
    { id: 'output', label: '输出', icon: '📄' },
  ]

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <div className="modal-title">Settings</div>
        </div>

        <div className="settings-body">
          {/* 左侧标签导航 */}
          <div className="settings-tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`settings-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="settings-tab-icon">{tab.icon}</span>
                <span className="settings-tab-label">{tab.label}</span>
              </button>
            ))}
          </div>

          {/* 右侧内容区 */}
          <div className="settings-content">
            {activeTab === 'appearance' && (
              <AppearancePanel
                settings={settings.appearance}
                onUpdate={(key, value) => onUpdate('appearance', key, value)}
              />
            )}
            {activeTab === 'language' && (
              <LanguagePanel
                settings={settings.language}
                onUpdate={(key, value) => onUpdate('language', key, value)}
              />
            )}
            {activeTab === 'image' && (
              <ImagePanel
                settings={settings.image}
                onUpdate={(key, value) => onUpdate('image', key, value)}
              />
            )}
            {activeTab === 'output' && (
              <OutputPanel
                settings={settings.output}
                onUpdate={(key, value) => onUpdate('output', key, value)}
              />
            )}
          </div>
        </div>

        <div className="modal-actions">
          <button className="modal-btn secondary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}

// ===== 外观设置面板 =====
type AppearancePanelProps = {
  settings: AppSettings['appearance']
  onUpdate: <K extends keyof AppSettings['appearance']>(
    key: K,
    value: AppSettings['appearance'][K]
  ) => void
}

const AppearancePanel: FC<AppearancePanelProps> = ({ settings, onUpdate }) => (
  <div className="settings-panel">
    <h3 className="settings-panel-title">外观设置</h3>

    <div className="settings-field">
      <label className="settings-label">主题</label>
      <div className="settings-options">
        {[
          { value: 'light', icon: '☀️', label: '浅色' },
          { value: 'dark', icon: '🌙', label: '深色' },
          { value: 'system', icon: '💻', label: '跟随系统' },
        ].map((opt) => (
          <button
            key={opt.value}
            className={`settings-option ${settings.theme === opt.value ? 'active' : ''}`}
            onClick={() => onUpdate('theme', opt.value as Theme)}
          >
            <span>{opt.icon}</span>
            <span>{opt.label}</span>
          </button>
        ))}
      </div>
    </div>

    <div className="settings-field">
      <label className="settings-label">字体大小</label>
      <div className="settings-slider-row">
        <input
          type="range"
          min="12"
          max="24"
          value={settings.fontSize}
          onChange={(e) => onUpdate('fontSize', Number(e.target.value))}
        />
        <span className="settings-value">{settings.fontSize}px</span>
      </div>
    </div>

    <div className="settings-field">
      <label className="settings-label">字体族</label>
      <select
        value={settings.fontFamily}
        onChange={(e) => onUpdate('fontFamily', e.target.value)}
        className="settings-select"
      >
        <option value="Inter">Inter</option>
        <option value="JetBrains Mono">JetBrains Mono</option>
        <option value="SF Pro">SF Pro</option>
      </select>
    </div>

    <div className="settings-field">
      <label className="settings-label">行高</label>
      <div className="settings-slider-row">
        <input
          type="range"
          min="1.2"
          max="2.0"
          step="0.1"
          value={settings.lineHeight}
          onChange={(e) => onUpdate('lineHeight', Number(e.target.value))}
        />
        <span className="settings-value">{settings.lineHeight}</span>
      </div>
    </div>
  </div>
)

// ===== 语言设置面板 =====
type LanguagePanelProps = {
  settings: AppSettings['language']
  onUpdate: <K extends keyof AppSettings['language']>(
    key: K,
    value: AppSettings['language'][K]
  ) => void
}

const LanguagePanel: FC<LanguagePanelProps> = ({ settings, onUpdate }) => (
  <div className="settings-panel">
    <h3 className="settings-panel-title">语言设置</h3>

    <div className="settings-field">
      <label className="settings-label">界面语言</label>
      <div className="settings-options">
        {[
          { value: 'zh-CN', icon: '🇨🇳', label: '简体中文' },
          { value: 'en-US', icon: '🇺🇸', label: 'English' },
        ].map((opt) => (
          <button
            key={opt.value}
            className={`settings-option ${settings.uiLanguage === opt.value ? 'active' : ''}`}
            onClick={() => onUpdate('uiLanguage', opt.value as UiLanguage)}
          >
            <span>{opt.icon}</span>
            <span>{opt.label}</span>
          </button>
        ))}
      </div>
    </div>

    <div className="settings-field">
      <label className="settings-label">拼写检查语言</label>
      <select
        value={settings.spellCheckLanguage || ''}
        onChange={(e) => onUpdate('spellCheckLanguage', e.target.value || null)}
        className="settings-select"
      >
        <option value="">禁用</option>
        <option value="zh-CN">简体中文</option>
        <option value="en-US">English (US)</option>
        <option value="en-GB">English (UK)</option>
      </select>
    </div>
  </div>
)

// ===== 图像设置面板 =====
type ImagePanelProps = {
  settings: AppSettings['image']
  onUpdate: <K extends keyof AppSettings['image']>(
    key: K,
    value: AppSettings['image'][K]
  ) => void
}

const ImagePanel: FC<ImagePanelProps> = ({ settings, onUpdate }) => (
  <div className="settings-panel">
    <h3 className="settings-panel-title">图像设置</h3>

    <div className="settings-field">
      <label className="settings-label">默认图片格式</label>
      <div className="settings-options">
        {[
          { value: 'png', label: 'PNG (无损)' },
          { value: 'jpg', label: 'JPG (压缩)' },
          { value: 'webp', label: 'WebP (推荐)' },
        ].map((opt) => (
          <button
            key={opt.value}
            className={`settings-option ${settings.defaultFormat === opt.value ? 'active' : ''}`}
            onClick={() => onUpdate('defaultFormat', opt.value as ImageFormat)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>

    <div className="settings-field">
      <label className="settings-label">压缩质量</label>
      <div className="settings-slider-row">
        <input
          type="range"
          min="1"
          max="100"
          value={settings.quality}
          onChange={(e) => onUpdate('quality', Number(e.target.value))}
        />
        <span className="settings-value">{settings.quality}%</span>
      </div>
    </div>

    <div className="settings-field">
      <label className="settings-label">最大宽度 (px)</label>
      <input
        type="number"
        min="100"
        max="4096"
        value={settings.maxWidth}
        onChange={(e) => onUpdate('maxWidth', Number(e.target.value))}
        className="settings-input"
      />
      <span className="settings-hint">超过此宽度将自动缩放</span>
    </div>

    <div className="settings-field">
      <label className="settings-label">保存目录</label>
      <input
        type="text"
        value={settings.saveDirectory}
        onChange={(e) => onUpdate('saveDirectory', e.target.value)}
        placeholder="images"
        className="settings-input"
      />
      <span className="settings-hint">相对于文档所在目录</span>
    </div>
  </div>
)

// ===== 输出设置面板 =====
type OutputPanelProps = {
  settings: AppSettings['output']
  onUpdate: <K extends keyof AppSettings['output']>(
    key: K,
    value: AppSettings['output'][K]
  ) => void
}

const OutputPanel: FC<OutputPanelProps> = ({ settings, onUpdate }) => (
  <div className="settings-panel">
    <h3 className="settings-panel-title">输出设置</h3>

    <div className="settings-field">
      <label className="settings-label">PDF 纸张大小</label>
      <div className="settings-options">
        {[
          { value: 'A4', label: 'A4' },
          { value: 'A3', label: 'A3' },
          { value: 'Letter', label: 'Letter' },
        ].map((opt) => (
          <button
            key={opt.value}
            className={`settings-option ${settings.pdfPaperSize === opt.value ? 'active' : ''}`}
            onClick={() => onUpdate('pdfPaperSize', opt.value as PdfPaperSize)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>

    <div className="settings-field">
      <label className="settings-label">PDF 页边距 (mm)</label>
      <input
        type="number"
        min="0"
        max="50"
        value={settings.pdfMargin}
        onChange={(e) => onUpdate('pdfMargin', Number(e.target.value))}
        className="settings-input"
      />
    </div>

    <div className="settings-field">
      <label className="settings-checkbox-label">
        <input
          type="checkbox"
          checked={settings.htmlInlineStyles}
          onChange={(e) => onUpdate('htmlInlineStyles', e.target.checked)}
        />
        HTML 导出内联样式
      </label>
      <span className="settings-hint">便于分享和嵌入</span>
    </div>

    <div className="settings-field">
      <label className="settings-checkbox-label">
        <input
          type="checkbox"
          checked={settings.exportRenderedMermaid}
          onChange={(e) => onUpdate('exportRenderedMermaid', e.target.checked)}
        />
        导出时渲染 Mermaid 图表
      </label>
      <span className="settings-hint">将 Mermaid 代码转换为图片</span>
    </div>
  </div>
)
```

---

### 步骤 7: 创建对话框样式文件

**新建文件**: `app/src/components/SettingsDialog.css`

```css
.settings-modal {
  min-width: 640px;
  max-width: 720px;
  height: 520px;
  display: flex;
  flex-direction: column;
}

.settings-header {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--z-color-border-subtle);
}

.settings-body {
  flex: 1;
  display: flex;
  gap: 16px;
  min-height: 0;
  overflow: hidden;
}

/* 左侧标签导航 */
.settings-tabs {
  width: 140px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-right: 12px;
  border-right: 1px solid var(--z-color-border-subtle);
}

.settings-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: none;
  border-radius: var(--z-radius-sm);
  background: transparent;
  color: var(--z-color-fg-muted);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: left;
}

.settings-tab:hover {
  background: var(--z-color-bg-surface);
  color: var(--z-color-fg-default);
}

.settings-tab.active {
  background: rgba(37, 99, 235, 0.15);
  color: var(--z-color-fg-default);
}

.settings-tab-icon {
  font-size: 14px;
}

/* 右侧内容区 */
.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.settings-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.settings-panel-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--z-color-fg-default);
  margin: 0 0 8px;
}

.settings-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.settings-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--z-color-fg-subtle);
}

.settings-checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--z-color-fg-default);
  cursor: pointer;
}

.settings-options {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.settings-option {
  flex: 1;
  min-width: 80px;
  padding: 8px 12px;
  border: 1px solid var(--z-color-border-subtle);
  border-radius: var(--z-radius-sm);
  background: var(--z-color-bg-surface);
  color: var(--z-color-fg-default);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.settings-option:hover {
  border-color: var(--z-color-accent-primary);
}

.settings-option.active {
  border-color: var(--z-color-accent-primary);
  background: rgba(37, 99, 235, 0.15);
}

.settings-slider-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.settings-slider-row input[type="range"] {
  flex: 1;
}

.settings-value {
  font-size: 12px;
  color: var(--z-color-fg-muted);
  font-family: monospace;
  min-width: 40px;
  text-align: right;
}

.settings-hint {
  font-size: 11px;
  color: var(--z-color-fg-muted);
}

.settings-input,
.settings-select {
  padding: 8px 12px;
  border: 1px solid var(--z-color-border-subtle);
  border-radius: var(--z-radius-sm);
  background: var(--z-color-bg-surface);
  color: var(--z-color-fg-default);
  font-size: 13px;
}

.settings-input:focus,
.settings-select:focus {
  outline: none;
  border-color: var(--z-color-accent-primary);
}

.settings-input[type="number"] {
  width: 120px;
}
```

---

### 步骤 8: 注册 open_settings 命令

**文件**: `app/src/modules/commands/registry.ts`

**8.1 添加命令上下文类型**

```typescript
// 在文件顶部添加到类型定义区域
export type SettingsCommandContext = StatusContext & {
  openSettingsDialog?: () => void
}

// 更新 CommandContext 类型
export type CommandContext = LayoutCommandContext &
  FileCommandContext &
  AppLifecycleCommandContext &
  HelpCommandContext &
  AiCommandContext &
  SettingsCommandContext  // 新增
```

**8.2 添加设置命令工厂**

```typescript
function createSettingsCommands(ctx: SettingsCommandContext): CommandRegistry {
  return {
    open_settings: () => {
      if (ctx.openSettingsDialog) {
        ctx.openSettingsDialog()
      } else {
        ctx.setStatusMessage('Settings 对话框未初始化')
      }
    },
  }
}
```

**8.3 合并到主注册表**

```typescript
export const createCommandRegistry = (ctx: CommandContext): CommandRegistry => ({
  ...createLayoutCommands(ctx),
  ...createFileCommands(ctx),
  ...createLifecycleCommands(ctx),
  ...createClipboardCommands(ctx),
  ...createHelpCommands(ctx),
  ...createAiCommands(ctx),
  ...createSettingsCommands(ctx),  // 新增
})
```

---

### 步骤 9: 创建主题 CSS 变量文件

**新建文件**: `app/src/styles/themes.css`

```css
/* ===== 暗色主题（默认） ===== */
[data-theme="dark"],
:root {
  /* 背景色 */
  --z-color-bg-app: #05060a;
  --z-color-bg-elevated: rgba(5, 7, 12, 0.96);
  --z-color-bg-elevated-soft: rgba(8, 10, 18, 0.7);
  --z-color-bg-surface: rgba(255, 255, 255, 0.02);
  --z-color-bg-overlay: rgba(15, 23, 42, 0.98);
  
  /* 前景色/文字色 */
  --z-color-fg-default: #e8ecf5;
  --z-color-fg-muted: #9ca3af;
  --z-color-fg-subtle: #8fa1c7;
  --z-color-fg-accent: #9ab8ff;
  
  /* 边框色 */
  --z-color-border-subtle: rgba(255, 255, 255, 0.06);
  --z-color-border-strong: rgba(148, 163, 184, 0.35);
  
  /* 强调色 */
  --z-color-accent-primary: #2563eb;
  --z-color-accent-primary-soft: #3b82f6;
  --z-color-accent-success: #5ad8a6;
  --z-color-danger: #f87171;
  
  /* 阴影 */
  --z-shadow-elevated: 0 10px 30px rgba(0, 0, 0, 0.4);
}

/* ===== 亮色主题 ===== */
[data-theme="light"] {
  /* 背景色 */
  --z-color-bg-app: #f8fafc;
  --z-color-bg-elevated: rgba(255, 255, 255, 0.96);
  --z-color-bg-elevated-soft: rgba(248, 250, 252, 0.7);
  --z-color-bg-surface: rgba(0, 0, 0, 0.02);
  --z-color-bg-overlay: rgba(255, 255, 255, 0.98);
  
  /* 前景色/文字色 */
  --z-color-fg-default: #1e293b;
  --z-color-fg-muted: #64748b;
  --z-color-fg-subtle: #475569;
  --z-color-fg-accent: #2563eb;
  
  /* 边框色 */
  --z-color-border-subtle: rgba(0, 0, 0, 0.06);
  --z-color-border-strong: rgba(148, 163, 184, 0.35);
  
  /* 强调色 */
  --z-color-accent-primary: #2563eb;
  --z-color-accent-primary-soft: #3b82f6;
  --z-color-accent-success: #10b981;
  --z-color-danger: #ef4444;
  
  /* 阴影 */
  --z-shadow-elevated: 0 10px 30px rgba(0, 0, 0, 0.1);
}
```

---

### 步骤 10: 集成到 WorkspaceShell

**文件**: `app/src/components/WorkspaceShell.tsx`

**10.1 添加导入**

```tsx
// 在文件顶部添加导入
import { SettingsDialog } from './SettingsDialog'
import { useAppSettings } from '../hooks/useAppSettings'
import { useTheme } from '../hooks/useTheme'
```

**10.2 添加状态和 Hook 调用**

```tsx
// 在组件内部，其他 useState 附近添加
const [settingsOpen, setSettingsOpen] = useState(false)
const { settings, loaded, load, update } = useAppSettings()

// 应用主题
useTheme(settings.appearance.theme)

// 初始化时加载设置
useEffect(() => {
  load()
}, [load])
```

**10.3 添加到 useCommandSystem 参数**

```tsx
useCommandSystem({
  // ... 现有参数 ...
  openSettingsDialog: () => setSettingsOpen(true),
})
```

**10.4 渲染 Settings 对话框**

```tsx
// 在 return 的 JSX 中，其他对话框附近添加
<SettingsDialog
  open={settingsOpen}
  onClose={() => setSettingsOpen(false)}
  settings={settings}
  onUpdate={update}
/>
```

---

### 步骤 11: 导入主题文件

**文件**: `app/src/main.tsx`

```tsx
// 在文件顶部添加
import './styles/themes.css'
```

---

## 5. 文件修改清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `app/src-tauri/src/lib.rs` | 修改 | 添加菜单项、结构体和命令 |
| `app/src/types/settings.ts` | 新建 | 类型定义 |
| `app/src/hooks/useAppSettings.ts` | 新建 | 设置状态管理 |
| `app/src/hooks/useTheme.ts` | 新建 | 主题切换逻辑 |
| `app/src/components/SettingsDialog.tsx` | 新建 | 设置对话框 |
| `app/src/components/SettingsDialog.css` | 新建 | 对话框样式 |
| `app/src/modules/commands/registry.ts` | 修改 | 注册命令 |
| `app/src/components/WorkspaceShell.tsx` | 修改 | 集成对话框 |
| `app/src/styles/themes.css` | 新建 | 主题变量 |
| `app/src/main.tsx` | 修改 | 导入主题文件 |

---

## 6. 交互流程

```
用户点击 HaoMD → Settings
        ↓
触发 menu://action 事件 (id: "open_settings")
        ↓
useCommandSystem 接收事件，调用 openSettingsDialog()
        ↓
setSettingsOpen(true) 打开 SettingsDialog
        ↓
用户修改设置 → 调用 onUpdate(category, key, value)
        ↓
useAppSettings.update() 更新本地状态 + 保存到后端
        ↓
主题等设置立即生效（useTheme 监听变化）
```

---

## 7. 后续扩展

### 7.1 语言国际化

需要配合 i18n 库（如 `react-i18next`）实现完整的多语言支持：

1. 安装依赖: `bun add react-i18next i18next`
2. 创建语言文件: `locales/zh-CN.json`, `locales/en-US.json`
3. 在 `useAppSettings` 中监听 `language.uiLanguage` 变化
4. 调用 `i18n.changeLanguage()` 切换语言

### 7.2 CodeMirror 主题

编辑器组件需要单独处理主题切换：

```typescript
// 在 EditorPane 中
import { oneDark } from '@codemirror/theme-one-dark'

// 根据 data-theme 属性切换编辑器主题
const editorTheme = useMemo(() => {
  const theme = document.documentElement.getAttribute('data-theme')
  return theme === 'dark' ? oneDark : []
}, [/* 监听主题变化 */])
```

### 7.3 Mermaid/KaTeX 主题

这些渲染库可能需要额外处理：

- Mermaid: 在初始化时设置 `theme: 'dark' | 'default'`
- KaTeX: 通过 CSS 变量或类名切换样式

---

## 8. 注意事项

1. **设置自动保存**: 当前设计是每次修改立即保存，如需改为手动保存，需添加"应用"按钮
2. **设置迁移**: 如果后续新增设置项，需要处理旧版本 settings.json 的兼容
3. **设置验证**: 后端可添加字段验证逻辑，防止无效值
4. **性能优化**: 对于频繁变化的设置（如滑块），可考虑防抖保存
