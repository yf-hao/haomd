# Changelog

All notable changes to this project will be documented in this file.

## [v0.10.0] - 2026-04-25

### 中文

本次版本（v0.10.0）引入了 AI 助理对本地文件系统的直接操作支持。现在，用户可以通过 AI 助理管理工作区，包括创建、重命名或删除文件与目录。

#### 💡 主要更新
*   **物理文件管理**：支持通过 AI 助理执行重命名、删除当前文档或目录的操作。
*   **目录结构自动化**：AI 可根据指令自动创建文件夹，辅助优化笔记的组织结构。
*   **工作区感知增强**：优化了 AI 对工作区根目录的识别逻辑，提升了跨目录操作的准确度。
*   **技能与工作流深度集成**：自定义 Skills 和 Workflows 现已接入 Tool Calling 链路，支持在对话中直接调用执行。
*   **上下文感知优化**：改进了 AI 对当前文件路径和名称的识别逻辑，提高了多文档任务处理的精确度。

---

### English

Version v0.10.0 introduces direct file system management capabilities for the AI assistant. Users can now utilize the AI to manage their workspace, including creating, renaming, or deleting files and directories.

#### 💡 Key Updates
*   **Physical File Management**: Added support for renaming and deleting documents or folders via the AI assistant.
*   **Automated Directory Structure**: AI can now automatically create folders to optimize note organization.
*   **Enhanced Workspace Awareness**: Improved AI's recognition of the workspace root, increasing the accuracy of cross-directory operations.
*   **Deep Skill & Workflow Integration**: Custom Skills and Workflows are now integrated into the Tool Calling pipeline for direct execution via chat.
*   **Contextual Perception Optimization**: Refined AI's awareness of current file paths and names, improving accuracy in multi-document tasks.

---

## [v0.9.1] - 2026-04-20

### 中文

本次版本（v0.9.1）是一个针对 v0.9.0 系列的关键补丁更新，重点解决了 Windows 平台的构建兼容性问题，并优化了版本分发规范。

#### 🔧 系统修复与构建优化
*   **跨平台编译修复 (Critical)**：移除了在 Windows 下导致编译失败的 `quick-js` 依赖，迁移至原生支持 MSVC 编译的 `rquickjs`，确保 Windows/macOS/Linux 构建一致性。
*   **版本规范优化**：调整版本号为纯数字后缀以适配 Windows MSI (WiX) 安装包的严苛安全校验。
*   **内置说明书升级**：在 `Help` 菜单中新增了“版本说明 (Release Notes)”指令，支持在编辑器内直接以 Markdown 标签页形式查看最新更新动态。

---

### English

Version v0.9.1 is a critical patch update for the v0.9.0 series, focusing on resolving Windows build compatibility issues and standardizing distribution requirements.

#### 🔧 System Fixes & Build Optimizations
*   **Cross-platform Compilation (Critical)**: Replaced `quick-js` with `rquickjs` to resolve structural build failures on Windows (MSVC). This ensures a deterministic build process across Windows, macOS, and Linux.
*   **Installer Compatibility**: Standardized versioning to a numeric-friendly format to satisfy strict Windows MSI (WiX) bundling requirements.
*   **In-app Release Notes**: Added a "Release Notes" action under the `Help` menu, allowing you to view the latest changelog directly as a read-only editor tab inside the workspace.

---

## [v0.9.0-alpha] - 2026-04-20

### 中文

本次 Alpha 测试版本标志着 HaoMD **由单一文档编辑器向“智能体增强知识工作站”的跃升**。我们重构了底层模型兼容规范，并引入了全新的技能工作流体系与图文多模态生成能力。鉴于此次核心架构改动较深，特发布为 Alpha 版本以便收集体验反馈并持续优化稳定性。

#### ✨ 新特性 (Alpha)

*   **工作流与技能自动化引擎 (Workflows & Skills)**：
    *   新增专属的 `SkillsPanel` 技能侧边栏面板，并在 UI 层面增加了对应的触发图标和配置模态框。
    *   引入了应用级 Web Workflows 运行时架构（并内置多个运行示例）。
    *   支持“让 AI 帮你写技能 (Skill AI authoring flow)”，允许通过自然语言对话驱动创建定制化工作流，并无缝支持会话状态的跨页面恢复。
*   **多模态生图接入 (Image Generation)**：
    *   深度接入 ModelScope（魔搭）模型生态，为编辑器首次引入了文生图等视觉创造能力。
*   **多模型极客兼容网络 (Universal Model Integration)**：
    *   核心重构：实现了涵盖底层消息结构、流式传输（Streaming）及复杂背景调度机制的全新 OpenAI API 兼容层。
    *   新增原生的 Gemini 模型体系适配，确保其在内容生成管线与前端 UI 发送接收逻辑上的完美协同。

#### 🔧 系统改进 与修复

*   **会话路由隔离修复**：修复了在 AI 界面与编辑器跳转期间，AI 聊天持久化路径寻址可能出现的脱离绑定或错位路由问题。
*   **Rust 工具链稳固**：对后端 Cargo 编译链路显式进行了 `rust-toolchain` 版本锁定，从根源上防止因构建环境不一致导致的跨平台打包报错。
*   **精简配置负重**：清理并废弃了项目中的冗余 Workspace 旧格式配置项，进一步从基础上缩减了内部调用链路。

---

### English

This Alpha release signifies a major leap for HaoMD—from a standard markdown editor into an **Agent-Enhanced Knowledge Workspace**. We have entirely refactored the model compatibility layer and introduced robust programmatic skills workflows alongside structural multi-modal generation. Given the enormous architectural shifts, this holds an Alpha designation to help refine stability.

#### ✨ New Features (Alpha)

*   **Workflows & Skills Engine**:
    *   Introduced a dedicated `SkillsPanel` management drawer, complete with activity icons and an interactive skill editor modal.
    *   Implemented a foundational Workflows runtime natively running tailored automated logic.
    *   Added a novel "Skill AI Authoring Flow" that enables you to collaborate directly with AI to build custom skills, featuring robust context restoration.
*   **Image Generation Integrations**:
    *   Integrated ModelScope into the generation pipeline, bringing text-to-image AI capabilities right inside the editor workflow.
*   **Universal Model Refactoring**:
    *   Overhauled the OpenAI compatibility layer with full streaming capability, handling deeper, updated message structures and robust background execution logic.
    *   Shipped native, verified Gemini integration natively linked to both prompt mechanisms and the UI presentation layers.

#### 🔧 System Refinements & Fixes

*   **Session Persistence Resilience**: Fixed critical routing bugs where AI chat history states could inadvertently break their local persistence bounds during intricate screen transitions.
*   **Cross-platform Reproducibility**: Explicitly pinned the Rust toolchain version for the Tauri backend to guarantee deterministic, conflict-free compilation runs.
*   **Configuration Cleanup**: Eliminated legacy workspace configuration artifacts to clean up the project hierarchy and drop runtime ambiguity.

---

## [v0.8.0] - 2026-04-13

### 中文

本次更新带来了**AI 会话性能的重大突破**，重点引入了全新的**后台自动压缩引擎**与**聊天增量加载机制**，有效解决了超长对话带来的 Token 膨胀与界面渲染卡顿问题。同时对工作区的级联滚动冲突进行了深度的系统级修复。

#### ✨ 新特性

*   **智能 AI 上下文后台压缩系统**：
    *   引入了底层“发后即忘 (fire-and-forget)”的异步状态压缩任务机制，并配有可重入锁 (re-entry guard) 以彻底杜绝并发读写冲突。
    *   实现了 6 项系统的压缩策略优化：支持在任意时机触发压缩、自动分类整理上下文，并专门保护原始用户输入不被暴力截断。
    *   **状态栏进度感知**：在底部状态栏新增了非侵入式的实时压缩状态指示（压缩中/已完成）。
    *   **智能 Token 阻断**：将会话中保留的最大用户消息数精准备制为 50 条，避免在深度长对话中引发 Token 爆炸与服务商计费超限。
*   **Web Lite App 支持**：新增并完善了轻量级 Web 版本的基础支撑框架，为后续的跨平台和浏览器原生访问提供支持。

#### 💄 体验优化

*   **聊天记录增量加载**：重构了 AI 聊天窗口的 DOM 渲染逻辑，引入增量分批加载机制，使得切换或滚动包含海量历史消息的对话时依然如丝般顺滑。
*   **会话恢复与 UI 打磨**：提升了对话消息恢复阶段的内部容错逻辑，更新了随笔等特定分类的视觉图标，并对整个聊天面板的间距与排版进行了打磨。

#### 🔧 系统改进 与修复

*   **工作区防级联滚动修复**：解决了长期存在的交互顽疾——在编辑器中进行长篇文本输入大跨度换行时，意外触发祖先容器滚动，导致顶部 TabBar 及 AI 对话框 Header 被裁切遮挡的问题。
*   **标签栏脏状态截断修复**：调整了文件未保存状态（小圆点）的 DOM 结构关系，修复了在长文件名状态下小圆点容易被 Flex 容器强制挤压或截断的视觉 Bug。
*   **持久化健壮性**：修复并梳理了 AI 聊天状态在极端刷新或异常断开情况下的本地化持久存储逻辑。

---

### English

This release delivers **major breakthroughs in AI session performance**, introducing a brand-new **Background Context Compression Engine** and **Incremental Chat Loading**. These upgrades solve token bloat and UI lagging in extremely long conversations. Alongside this, we’ve rolled out robust structural fixes for workspace scroll clipping issues.

#### ✨ New Features

*   **Intelligent Background AI Context Compression**:
    *   Introduced a reliable "fire-and-forget" asynchronous compression pipeline, fully guarded against re-entry data races.
    *   Implemented 6 comprehensive strategies including on-demand triggering, contextual categorization, and strict preservation of original user commands.
    *   **Live Status Indicators**: The primary status bar now displays unobtrusive, real-time visual feedback indicating when LLM compression sweeps are actively running.
    *   **Token Barrier Controls**: Hard-capped the maximum preserved raw user messages at 50, structurally preventing API token explosions and resource exhaustion in extremely lengthy chat histories.
*   **Web Lite App Foundations**: Shipped core architectural scaffolding for a "lite" web-based target variant, expanding deployment possibilities.

#### 💄 Improvements

*   **Incremental Chat Rendering**: Radically overhauled the AI chat window's rendering lifecycle to utilize incremental loading, ensuring a buttery-smooth frame rate even when rapidly switching into sessions holding massive message logs.
*   **Session Recovery & UI Polish**: Solidified the event recovery pipeline for chat restoration, updated category icons (e.g., essays), and systematically refined the paddings and alignments within the chat interface.

#### 🔧 System Refinements & Fixes

*   **Workspace Scroll-Cascade Guardrails**: Eradicated a deeply-rooted interaction bug where typing multi-line content or large cursor movements would inadvertently scroll the parent layout container—meaning the TabBar and AI chat headers are no longer frustratingly obscured or clipped.
*   **Tab Overflow Bug Fixes**: Repositioned the "unsaved edits" indicator (the dirty dot) outside of flex-truncation containers, ensuring it never gets squashed or hidden on severely long filenames.
*   **Robust State Persistence**: Addressed and smoothed out edge-case logic holes relating to how AI chat UI states sync into local storage during abrupt app interactions.

---

## [v0.7.0] - 2026-04-09

### 中文

#### ✨ 新特性

*   **WebDAV 后台恢复**：新增后台自动化备份恢复功能，支持在启动时通过云端数据自动恢复本地状态，并实时提示恢复进度。
*   **MCP 进程控制优化**：全面重构了 MCP (Model Context Protocol) 服务的进程启动与 stdio 通道管理，显著提升了工具加载的稳定性。
*   **异步系统交互**：将剪贴板读取等关键系统操作全量迁移为异步任务，彻底解决了在处理复杂剪贴板内容时的界面阻塞问题。

#### 🔧 系统改进 与修复

*   **并发冲突防护**：为图片保存流程引入互斥锁（Mutex），修复了在导出或同步过程中可能出现的并发访问冲突。
*   **智能备份过滤**：新增备份排除机制，自动过滤临时状态文件，缩减备份体积并缩短同步时间。
*   **数据平滑迁移**：重构了应用配置与状态的存储路径解析逻辑，增加了旧版本路径数据的自动迁移支持。

---

### English

#### ✨ New Features

*   **WebDAV Background Recovery**: Introduced automated background data restoration via WebDAV, allowing the app to sync local state with cloud backups at startup with live progress tracking.
*   **Optimized MCP Process Lifecycle**: Overhauled MCP (Model Context Protocol) service initialization and stdio channel management, significantly boosting reliability and startup speed.
*   **Non-blocking System I/O**: Transitioned all clipboard and critical system interactions to an asynchronous execution model, eliminating UI stutters when handling heavy content.

#### 🔧 System Refinements & Fixes

*   **Concurrency Guardrails**: Implemented a Mutex lock for image saving operations to resolve potential data race issues during high-frequency exports or syncs.
*   **Smarter Backup Exclusion**: Added an intelligent exclusion list for temporary state files, optimizing backup size and reducing synchronization latency.
*   **Seamless Path Migration**: Refactored application state and configuration path resolution to include automatic migration support for legacy storage locations.

---

## [v0.6.1] - 2026-04-07

### 中文

#### 💄 体验优化

*   **MCP 设置对话框优化**：优化了 MCP (Model Context Protocol) 设置界面的布局与响应式设计，提升了在不同窗口尺寸下的显示效果。

---

### English

#### 💄 Improvements

*   **MCP Settings Polish**: Refined the layout and responsiveness of the MCP (Model Context Protocol) settings dialog for a better experience across various window sizes.

---

## [v0.6.0] - 2026-04-06

### 中文

本次更新带来了多项重量级功能，重点包括 **MCP (Model Context Protocol) 集成**、**AI 会话侧边栏与 ChatGPT 布局**、**设置同步**以及**文件管理优化**。

#### ✨ 新特性

*   **MCP (Model Context Protocol) 深度集成**：支持工具服务与函数调用（Function Calling），AI 现在可以调用外部工具（如计算、搜索、API 等）来辅助创作。
*   **AI 会话管理侧边栏**：新增了独立的 AI 会话历史管理面板，支持历史记录的持久化存储与快速切换。
*   **ChatGPT 式对话布局**：引入全新的全屏（Fullpage）对话 UI，提供更纯粹、沉浸式的 AI 交互体验。
*   **设置备份与 WebDAV 服务器同步**：支持应用配置的自动化备份与多设备同步，确保体验的一致性。
*   **侧边栏文件管理优化**：文件树现在支持折叠/展开，并优化了文件夹的展现形式，提升大型项目的管理效率。
*   **AI 会话自动命名**：在 AI 首次回复后，系统会自动根据对话上下文生成直观的会话标题。
*   **Dify Naming ID 持久化**：增强了与 Dify 的集成，会话命名 ID 现在可通过 Tauri 后端稳定持久化。

#### 🔧 系统改进 与修复

*   **侧边栏交互优化**：修复了在不同面板间切换时 sessionKey 可能丢失的问题，确保会话上下文的连续性。
*   **样式打磨**：优化了全屏对话模式下的输入框样式，隐藏了冗余的装饰条。
*   **时间格式转换**：统一了会话面板的时间显示格式为 `yyyy-MM-dd HH:mm`。

---

### English

This release introduces several major features, including **MCP (Model Context Protocol) integration**, **AI Chat Sessions Sidebar & ChatGPT Layout**, **Settings Sync**, and **enhanced file management**.

#### ✨ New Features

*   **Deep MCP (Model Context Protocol) Integration**: Support for tool services and Function Calling, allowing AI to invoke external tools (e.g., calculations, searches, APIs) during document assistance.
*   **AI Session Management Sidebar**: A dedicated panel for managing chat history with persistent storage and rapid switching.
*   **Fullpage ChatGPT-style Layout**: A brand-new immersive conversation UI for a more focused AI interaction experience.
*   **Settings Backup & WebDAV Sync**: Automated backup and cross-device synchronization of application preferences via WebDAV.
*   **Optimized Sidebar Management**: Collapsible folder structures in the file tree for better organization of complex workspaces.
*   **Auto-session Naming**: Automatically generates descriptive titles for AI conversations based on initial responses.
*   **Persistent Naming Context**: Improved Dify integration with backend-level persistence for conversational metadata.

#### 🔧 System Refinements & Fixes

*   **Sidebar Interaction Polish**: Resolved issues where session keys would reset during panel switching, ensuring consistent context tracking.
*   **Visual Refinements**: Cleaned up input box styles in full-page mode and standardized time formatting to `yyyy-MM-dd HH:mm`.

---

## [v0.5.0] - 2026-04-03

### 中文

本次更新带来了**性能上的重大突破**以及**专业文档处理能力的进一步增强**。重点包括 WYSIWYG 编辑器的块级增量序列化、Word 导出引擎的模板化重构、数学符号库的深度扩展，以及 AI 文档对话与系统级打印的支持。

#### ✨ 新特性

*   **WYSIWYG 块级增量序列化**：大幅优化了大文档的编辑性能。现在仅对发生变更的区块进行实时序列化，性能提升 **15-50 倍**，彻底告别长文档编辑卡顿。
*   **Word 导出模板系统升级**：
    *   **模板填充支持**：现支持通过预设的 Word 模板文件进行数据填充，并可直接在导出时解析 Markdown 内容填充占位符。
    *   **Front Matter 配置**：支持在文档属性（Front Matter）中通过 `word_template` 字段直接指定模板，移除了设置中冗余的通用模板选择。
*   **数学符号库与预览对话框**：
    *   新增希腊字母、离散数学、高等数学等分类的快捷插入子菜单。
    *   配备了基于 KaTeX 的实时渲染预览对话框，确保插入前即可确认符号形态。
*   **专业打印与 PDF 优化**：
    *   **原生打印支持**：新增系统级打印能力，可代替旧版 PDF 导出以获得更好的排版一致性。
    *   **导出预渲染**：优化了 Mermaid 和 KaTeX 在 PDF/打印时的处理逻辑，采用静态预渲染确保无黑边、无偏移。
*   **AI 增强与文档对话**：
    *   **文档对话模块**：新增独立的文档对话功能模块，提升了 AI 对当前文档上下文的感知能力。
    *   **Provider 配置编辑**：AI 设置面板现支持对现有 Provider 信息的修改与禁用。
*   **文档上传支持**：重构了附件处理逻辑，现支持 PDF 等多种文档格式的上传管理。

#### 🔧 系统改进 与修复

*   **核心层 (lib.rs) 重构**：对底层架构进行了系统级梳理，提升了资源管理与跨平台接口的稳定性。
*   **样式一致性修复**：修复了 PDF 导出期间可能导致的预览区样式污染（段间距/行高改变）以及界面黑边问题。
*   **交互细节优化**：模型选择器由“悬停触发展开”改为“点击展开”，有效避免了操作干扰。

---

### English

This milestone release introduces **major performance breakthroughs** and **enhanced professional document capabilities**. Highlights include block-level incremental serialization for the WYSIWYG editor, a templated overhaul of the Word export engine, deep expansion of math symbol libraries, and new support for AI-driven document conversations and system-grade printing.

#### ✨ New Features

*   **Block-level Incremental WYSIWYG Serialization**: Massively optimized editing performance for large documents. By re-serializing only the actually modified blocks, performance is boosted by **15-50x**, ensuring fluid interaction with massive files.
*   **Upgraded Word Export Template System**:
    *   **Template Filling**: Now supports populating pre-defined Word templates with Markdown content during export.
    *   **Front Matter Configuration**: Control export templates directly via the `word_template` field in document properties, replacing the redundant global template selector.
*   **Math Symbol Library & Preview Dialog**:
    *   Added submenus for quick insertion of Greek letters, discrete math, and advanced calculus symbols.
    *   Featured a KaTeX-powered real-time preview dialog to verify symbol appearance before insertion.
*   **Native Printing & PDF Optimization**:
    *   **System Printing Support**: Added native system printing capability as a robust alternative to PDF export for superior layout consistency.
    *   **Export Pre-rendering**: Refined Mermaid and KaTeX processing for PDF/Printing, using static pre-rendering to eliminate black borders and layout shifts.
*   **AI & Document Conversations**:
    *   **Document Context Conversations**: A new dedicated module for AI interactions focused specifically on the active document’s context.
    *   **Provider Management**: AI settings now support editing and disabling existing custom Provider configurations.
*   **Multipart Document Upload**: Overhauled attachment handling to support uploading and managing PDF and other document types.

#### 🔧 System Refinements & Fixes

*   **Core Architectural Refactor (lib.rs)**: Systematically overhauled the Rust backend for improved resource management and API reliability.
*   **Visual Consistency Fixes**: Resolved style pollution issues where PDF export preparation would inadvertently alter editor layout (line height/spacing) or cause visual artifacts.
*   **Interaction Polish**: Changed the model selector trigger from "hover" to "click" to prevent accidental menu expansions.

---


## [v0.4.3] - 2026-03-25

### 中文

本次更新重点在于 **Word 导出渲染引擎的再升级**，并增强了 **搜索系统的易用性**，同时修复了发布流程中的关键故障。

#### ✨ 新特性

*   **Inkscape 支持集成**：导出 Word 时，现能调用系统级 Inkscape 工具优化 Mermaid 图表的渲染路径，确保生成的 SVG/图片更专业清晰。
*   **搜索预填功能**：编辑器内唤起搜索框（`Cmd + F`）时，会自动获取当前选中的文字作为初始搜索内容，减少重复输入。
*   **系统语言探测**：底层新增对用户系统默认语言的自动获取支持，为后续国际化的深度适配打下基础。

#### 🔧 系统改进 与修复

*   **CI 工作流故障修复**：针对发布脚本中 `CHANGELOG.md` 路径解析异常导致的工作流中断进行了针对性修复，打通了自动化发布链路。
*   **Word 导出 Mermaid 细节打磨**：进一步优化了图表在不同主题背景下的视觉兼容性。

---

### English

This release focuses on **upgrading the Word export rendering engine**, enhancing **search usability**, and resolving critical issues in the CI pipeline.

#### ✨ New Features

*   **Inkscape Integration for Word Export**: The app can now leverage system-installed Inkscape to optimize Mermaid diagram rendering, ensuring professional-grade visual clarity in exported documents.
*   **Smart Search Pre-fill**: When opening the Find & Replace bar (`Cmd + F`), any text currently selected in the editor will now be automatically pre-filled as the search term.
*   **System Language Detection**: Added a new core capability to automatically detect the user's system language, laying the groundwork for deeper i18n support.

#### 🔧 System Refinements & Fixes

*   **CI Workflow Reliability**: Fixed an `ENOENT` error in the release script where `CHANGELOG.md` couldn't be correctly located, ensuring stable automated deployments.
*   **Mermaid Export Polish**: Systematically refined the visual styles of Mermaid diagrams during Word export for better theme consistency.

---

## [v0.4.2] - 2026-03-25

### 中文

本次更新持续深化了 **Word 文档导出能力**，同时带来了编辑器标签栏的交互新体验，并修复了多处细节问题。

#### ✨ 新特性

*   **标签栏溢出菜单**：当标签页过多无法全部显示时，自动在右侧出现溢出菜单，点击即可快速切换到任意隐藏的标签页，极大优化了多文档工作流。
*   **MathML 表格转换支持**：Word 导出现在能正确处理包含表格的数学公式，同时优化了数学段落的对齐方式，导出内容更规范。

#### 💄 体验优化

*   **Word 导出 Mermaid 图表视觉优化**：提升了 Mermaid 图表导出为图片时的清晰度与样式一致性。
*   **移除 Word 导出中的水平分割线**：导出的 Word 文件不再包含 `---` 生成的分隔线，文档结构更整洁。

#### 🔧 系统改进 与修复

*   **输入框高度自适应修复**：改用 `useLayoutEffect` 优化了可变高度输入框的自动调整时机，消除了调整时的闪烁抖动问题。
*   **Markdown 查看器能力增强**：进一步完善了内置 Markdown 渲染器对复杂文档内容的支持。
*   **CI 工作流优化**：新增 Windows 平台下的 DOCX 导出验证，并将人工校验步骤独立为手动触发工作流，提升了发布前的质量保障机制。

---

### English

This release further deepens **Word export capabilities**, introduces a new tab bar overflow experience, and polishes several UI details.

#### ✨ New Features

*   **Tab Bar Overflow Menu**: When too many tabs are open to display at once, an overflow menu automatically appears on the right, allowing quick access to any hidden tab — greatly improving multi-document workflows.
*   **MathML Table Support in Word Export**: Tables within mathematical expressions are now correctly converted during Word export, with improved paragraph alignment for cleaner output.

#### 💄 Improvements

*   **Mermaid Diagram Visual Polish in Word Export**: Enhanced clarity and style consistency when Mermaid diagrams are rendered as images during export.
*   **Removed Horizontal Rules from Word Export**: The `---` divider is no longer exported as a visible element in Word documents, resulting in a cleaner structure.

#### 🔧 System Refinements & Fixes

*   **Input Auto-Resize Fix**: Switched to `useLayoutEffect` for variable-height input boxes, eliminating flickering and layout jank during auto-resize.
*   **Enhanced Markdown Viewer**: Improved the built-in Markdown renderer's handling of complex document structures.
*   **CI Workflow Improvements**: Added Windows DOCX export validation and moved manual verification steps to a dedicated manually-triggered workflow for better pre-release quality assurance.

---

## [v0.4.1] - 2026-03-23

### 中文

本次更新重点在于**提高系统稳定性**与**优化 AI 交互细节**，重点解决了 Word 导出对系统环境的过度依赖，并提升了对话响应的视觉反馈。

#### ✨ 新特性

*   **AI 聊天内联加载指示器**：在 AI 聊天详情页的消息流中直接展示加载状态，增强实时反馈。

#### 🔧 系统改进 与修复

*   **Word 导出架构升级 (Rust Zip)**：将 `.docx` 打包逻辑从外部系统命令迁移至 Rust 原生的 `zip` crate。
    *   **跨平台一致性**：不再依赖用户系统中是否安装了 `zip` 工具，大幅降低在特定环境下导出失败的概率。
    *   **性能提升**：提升了生成带有大量图片文档时的打包速度。

---

### English

This release focuses on **system stability** and **AI interaction refinements**, specifically addressing environment dependencies in Word export and improving message feedback.

#### ✨ New Features

*   **Inline AI Message Loading**: Added a context-aware loading indicator within the AI chat stream for dynamic response visualization.

#### 🔧 System Refinements & Fixes

*   **Word Export Architectural Overhaul**: Transitioned `.docx` packaging from external system calls to a native Rust `zip` crate.
    *   **Enhanced Reliability**: Eliminated dependency on system-level `zip` binaries, ensuring a stable export experience across all OS environments.
    *   **Performance Optimization**: Faster bundling for documents with high-density image content.

---

## [v0.4.0] - 2026-03-23

### 中文

本次更新带来了里程碑式的视觉与功能升级，重点包括**全平台多语言适配**、**全新的浅色模式与主题系统**，以及高度自由的**编辑器视觉自定义**能力。

#### ✨ 新特性

*   **多语言适配 (i18n)**：新增系统级多语言支持，支持在设置面板中一键切换应用界面语言。
*   **全新主题系统与浅色模式**：
    *   **浅色模式发布**：重新设计了所有 UI 组件在明亮环境下的视觉表现，阅读体验更清新。
    *   **独立主题中心**：预置了包括“浪漫主题”在内的多种精选手绘/配色风格。
    *   **基础架构升级**：全面重构 CSS 变量命名，确保主题切换时色彩与对比度的像素级精准控制。
*   **视觉自定义空间**：
    *   **背景图片支持**：现在可以为编辑器区域和 AI 聊天窗口分别设置自定义背景图。
    *   **样式深度调节**：支持调节背景图片的模糊度、透明度，打造专属的沉浸式写作环境。
*   **LaTeX 数学公式增强**：全面支持标准的 `$` (行内) 和 `$$` (块级) 分隔符，并规范化了数学表达式的转换与预处理逻辑。

#### 💄 体验优化

*   **图表渲染优化**：完善了 Mermaid 图表及交互组件在浅色/深色主题下的渲染色彩。
*   **UI 细节平滑化**：对各主题下的滚动条、焦点框及毛玻璃效果进行了系统性优化。

#### 🔧 系统改进 与修复

*   **测试稳定性增强**：优化了字体扫描服务的返回排序策略，消除了非确定性字体环境导致的自动化测试失败。

---

### English

This release marks a significant milestone in personalization and accessibility, introducing **Multi-language Support**, a brand-new **Light Mode & Theme Engine**, and extensive **Visual Customization** options for your workspace.

#### ✨ New Features

*   **Multi-language Support (i18n)**: System-wide internationalization is here. Switch between supported languages effortlessly via the new settings pane.
*   **Enhanced Theme Engine & Light Mode**:
    *   **Official Light Mode**: A meticulously redesigned bright theme for every UI component, offering a fresh and crisp reading experience.
    *   **Theme Selection Center**: Multiple curated themes (including the refined "Romantic" style) are now available.
    *   **Atomic CSS Tokens**: Overhauled the CSS variable system to ensure seamless transitions and accessibility across all themes.
*   **Visual Personalization**:
    *   **Custom Backgrounds**: You can now set unique background images for both the Markdown editor and the AI chat panel.
    *   **Interactive Styling**: Fine-grained controls for background opacity and blur to create your perfect writing ambiance.
*   **Standard LaTeX Integration**: Fully compatible with standard `$` (inline) and `$$` (block) delimiters, with normalized math expression preprocessing for faster, more accurate rendering.

#### 💄 Improvements

*   **Diagram Polish**: Enhanced Mermaid and chart rendering colors to ensure perfect visibility in both light and dark modes.
*   **UI Fluidity**: Standardized scrollbars, focus indicators, and frosted-glass effects across all themes.

#### 🔧 System Refinements & Fixes

*   **Test Suite Determinism**: Optimized the system font scanning service's sorting logic to ensure stable results across varying OS environments.

---

## [v0.3.0] - 2026-03-20

### 中文

本次更新是一个里程碑式的版本：**HaoMD 正式步入专业文档生产力工具阶段**。我们带来了全新的 **Word 导出引擎**（支持数学公式与图片排版）、统一的 **全局设置中心**，并进一步优化了 UI 组件，提升了跨文件协作的灵活性。

#### ✨ 新特性

*   **专业级 Word 导出引擎**：
    *   **数学公式完美支持**：利用 MathML 技术，将 Markdown 中的数学公式原生转换为 Word 可编辑的 Office Math 格式，满足学术与技术文档需求。
    *   **图片自动排版**：支持导出时图片自动缩放适应页面宽度，告别混乱的图片比例。
    *   **自定义导出样式**：新增导出标题与正文样式的深度设置，让生成的 Word 文件直接可用作正式交付版本。
*   **统一全局设置中心**：
    *   新增独立的“全局设置”面板，集成 AI 服务商配置、应用首选项及功能开关。
    *   **自定义 Badge 选择组件**：全新设计的配置选择器替代了原生下拉框，交互更自然且视觉更高级。
*   **外部文件协作**：新增支持直接在外部编辑器中打开指定文件，打通系统级文件处理流程。

#### 💄 体验优化

*   **README 文档更新**：详细梳理了最新的 AI 模型支持清单，并优化了整体代码排版与文档指引。
*   **UI 细节打磨**：对所有设置模态框的排版间距与选择逻辑进行了系统化微调。

#### 🔧 系统改进 与修复

*   **核心服务重构**：优化了导出逻辑底层，显著提升了大容量文档（包含大量图片/公式）的导出稳定性与成功率。

---

### English

This milestone release transforms **HaoMD into a professional-grade document productivity tool**. We are introducing a powerful new **Word Export Engine** (with math formula and image layout support), a unified **Global Settings Center**, and enhanced cross-file interaction capabilities.

#### ✨ New Features

*   **Professional Word Export Engine**:
    *   **Seamless Math Formula Support**: Leverages MathML technology to convert Markdown equations into native, editable Office Math objects in Word—perfect for academic and technical writing.
    *   **Automatic Image Layout**: Images are now automatically scaled to fit page width during export, ensuring clean and consistent document layout.
    *   **Advanced Export Styling**: Fine-grained settings for heading and body formatting, ensuring generated Word files are production-ready.
*   **Global Settings Center**:
    *   A dedicated "Global Settings" panel for managing AI Providers, app preferences, and feature toggles.
    *   **Custom Badge Select Components**: Brand-new UI components replace native dropdowns, offering a more intuitive and premium configuration experience.
*   **External File Integration**: New support for opening files in external default editors, streamlining your system-wide workflow.

#### 💄 Improvements

*   **Comprehensive README Refresh**: Updated lists of supported AI models and refined formatting for better clarity.
*   **UI/UX Polishing**: Standardized layout spacing and selection logic across all settings dialogs.

#### 🔧 System Refinements & Fixes

*   **Core Architecture Optimization**: Overhauled the export service backend to ensure high reliability when processing massive documents containing numerous images and formulas.

---

## [v0.2.3] - 2026-03-18

### 中文

本次更新重点增强了工作区的管理灵活性，丰富了文档导出与数学展示能力，并优化了交互界面的视觉一致性。主要带来了数学公式支持、Word 导出、全局设置、侧边栏重命名以及 AI 会话导入导出等功能。

#### ✨ 新特性

*   **数学公式支持**：集成 KaTeX 渲染引擎，支持在编辑器和预览区编写及查看数学公式。
*   **Word 导出功能**：新增对 Word (.docx) 格式的导出支持，并自动处理图片缩放以适配页面宽度。
*   **全局设置对话框**：新增统一的全局设置界面，支持配置应用通用选项，入口位于菜单栏及状态栏。
*   **侧边栏重命名**：支持在侧边栏直接对文件和文件夹进行重命名操作，提升文件管理效率。
*   **状态栏消息通知**：将原有的 Toast 弹出消息迁移至界面底部的状态栏显示，减少视觉干扰，让信息流转更自然。
*   **强制间隔保存**：新增强制自动保存功能，可设置时间间隔自动持久化变更，进一步保障数据安全。
*   **AI 会话导入导出**：支持将 AI 对话历史导出为文件或从文件导入，方便在不同工作区或设备间同步灵感。
*   **自定义 UI 组件 (Badge Selector)**：新增美观的徽章选择器组件替代原生下拉框，提升 UI 交互的一致性与美观度。
*   **外部文件打开**：支持通过系统默认程序直接从工作区打开外部文件。
*   **最近文件对话框交互优化**：进一步改善了最近文件模态窗的视觉样式与选择逻辑，切换文件更顺滑。
*   **AI 聊天消息上限提升**：将 AI 聊天界面最大可见消息数量提升至 50 条，以便回顾更长的上下文。

#### 🔧 系统改进与修复

*   **测试用例更新**：同步更新了 AI 文本选择相关指令的自动化测试用例，确保功能稳定性。

---

### English

This release focuses on enhancing workspace management, expanding document export and mathematical rendering capabilities, and refining UI consistency. Highlights include math formula support, Word export, global settings, and sidebar renaming.

#### ✨ New Features

*   **Math Formula Support**: Integrated KaTeX for rendering and previewing mathematical formulas within the editor and preview pane.
*   **Word Document Export**: Added support for exporting to Word (.docx) format, featuring automatic image scaling for better layout consistency.
*   **Global Settings Dialog**: A new centralized settings interface for managing application-wide preferences, accessible from the menu and status bar.
*   **Sidebar Renaming**: Directly rename files and folders from the sidebar, streamlining file management workflows.
*   **Status Bar Notifications**: Migrated status messages from pop-up Toasts to a persistent status bar at the bottom, reducing visual clutter.
*   **Forced Interval Saving**: Added a forced autosave mechanism that synchronizes changes at set intervals for enhanced data security.
*   **AI Session Import/Export**: Support for exporting AI conversation history to files and importing them back, facilitating easy sharing and backup.
*   **Custom UI Components (Badge Selector)**: Replaced native dropdowns with a polished badge selection component, enhancing UI aesthetics and consistency.
*   **Open External Files**: Support for opening files directly in the system's default application from the workspace.
*   **Recent Files Dialog Polish**: Refined the visual styling and interaction logic of the Recent Files modal for an even smoother switching experience.
*   **AI Chat Message Limit**: Increased the maximum number of visible messages in the AI chat panel to 50 for better context review.

#### 🔧 System Refinements & Fixes

*   **Test Suite Updates**: Updated automated test cases for AI text selection commands to ensure ongoing reliability.

---

## [v0.2.2] - 2026-03-16

### 中文

本次更新重点在于**编辑体验的深度打磨**与**性能表现的全面优化**。新增了最近文件快捷访问、.txt 文件支持及文档字数统计等功能，并对长文档滚动性能、组件加载逻辑进行了系统级重构，显著提升了应用的响应速度。

#### ✨ 新特性

*   **最近文件模态窗**：新增快捷访问界面，可快速查看并切换最近打开的文件，提升多任务处理效率。
*   **支持文本文件 (.txt)**：现在可以像编辑 Markdown 一样直接保存和打开 `.txt` 文本文件。
*   **编辑器空白区域聚焦**：优化了编辑器的点击逻辑，点击下方或周围的空白区域即可快速聚焦或滚动至末尾。
*   **文档字数统计**：新增实时的文档字数与行数统计功能，方便把控创作进度。
*   **动态加载组件**：图表组件与 AI 相关模块改为按需懒加载，有效缩短了首屏启动时间并降低资源占用。

#### 💄 体验优化

*   **Toast 通知替代 alert**：将所有繁琐的系统 `window.alert` 替换为优雅的 Toast 气泡通知。
*   **未保存标识优化**：使用更醒目的橙色圆点替代原有的实心圆点，未保存状态一目了然。
*   **AI 加载动画升级**：将 AI 回复时的旋转图标改为更具动感的跳动圆点，优化等待体验。
*   **图片加载容错**：优化了预览区图片加载失败时的视觉表现，增加虚线框与透明度处理。
*   **粘贴交互增强**：改进了粘贴内容的处理逻辑，并增加了粘贴时的瞬时高亮引导。

#### 🔧 系统改进与修复

*   **长文档滚动性能**：引入 CSS `content-visibility` 技术，大幅降低大容量文档滚动时的 CPU 占用。
*   **架构解耦 (Hooks)**：将侧边栏缩放、光标记忆、大文档逻辑等从核心组件拆分为独立的 Hook 模块，极大提升了代码的可维护性。
*   **z-index 规范化**：全面使用 CSS 变量管理层级关系，杜绝了 UI 遮挡异常风险。
*   **性能防抖优化**：为搜索栏等输入组件添加防抖处理，同步优化了预览同步损耗。
*   **稳定性维护**：修复了光标恢复逻辑中的 TDZ（暂时性死区）错误，并为预览区域增加了错误边界（Error Boundary）保护。

---

### English

This release focuses on **deepening the editing experience** and **system-wide performance optimization**. Highlights include a new Recent Files modal, support for .txt files, and document word statistics, alongside architectural refactoring to improve long-document responsiveness and component loading.

#### ✨ New Features

*   **Recent Files Modal**: Quick-access interface to browse and switch between recently opened files more efficiently.
*   **Plain Text Support (.txt)**: Open and save `.txt` files directly with the same seamless experience as Markdown.
*   **Blank Space Click-to-Focus**: Click anywhere in the editor's blank regions to instantly focus or scroll to the end.
*   **Word Count Statistics**: Integrated word and line counting to help track writing progress in real-time.
*   **Dynamic Component Loading**: Charts and AI modules are now lazy-loaded on demand, reducing initial bundle size and memory footprint.

#### 💄 Improvements

*   **Toast Notifications**: Replaced native `window.alert` dialogs with modern, non-intrusive Toast notifications.
*   **Unsaved State Dot**: Swapped the subtle indicator for a prominent orange dot, making unsaved changes much easier to spot.
*   **AI Loading Animation**: Updated the chat loading indicator from a spinner to a rhythmic jumping dot for a more lively feel.
*   **Image Error Handling**: Improved visual feedback for failed images in the preview area with dashed borders and reduced opacity.
*   **Enhanced Paste Logic**: Refined how pasted content is handled and added transient highlighting to indicate where text was inserted.

#### 🔧 System Refinements & Fixes

*   **Long Document Performance**: Adopted CSS `content-visibility` to drastically improve scrolling performance for massive documents.
*   **Hook-based Refactoring**: Debuilt monolithic logic (sidebar resizing, cursor memory, huge doc handling) into specialized hooks for better maintainability.
*   **Unified z-index Strategy**: Standardized layered ordering using CSS variables to prevent overlap issues.
*   **Debounced Input Handling**: Added debouncing to search and optimized editor-preview synchronization.
*   **Stability Fixes**: Resolved TDZ (Temporal Dead Zone) errors in cursor restoration and implemented Error Boundaries for the preview area.

---

## [v0.2.1] - 2026-03-14

### 中文

本次更新主要提升了文档编辑的连续性与预览能力的扩展，包括 Markdown 目录生成、编辑器状态持久化以及对 HTML 文件的内置预览支持。

#### ✨ 新特性

*   **Markdown 目录生成 (TOC)**：支持通过 `[TOC]` 占位符自动生成文档目录，并新增了可折叠结构支持与样式优化。
*   **HTML 文件预览**：应用现在支持直接预览工作区内的 HTML 文件，提升了多媒体/网页资源的查看能力。
*   **编辑器光标持久化**：应用会自动记录各文件的最后光标位置，在重新打开文件或切换标签页时自动恢复。
*   **插入代码块功能**：新增快捷键支持一键插入 Markdown 代码块模板。
*   **内置 Markdown 手册**：新增了《Markdown 从入门到进阶手册》的 HTML 版本，供用户随时参考。

#### 💄 体验优化

*   **粘贴快捷键增强**：为菜单项增加了标准的系统粘贴快捷键支持。
*   **窗口交互优化**：改进了启动和打开文件夹时的窗口显示逻辑，并移除了打开文件夹时冗余的未保存变更拦截。
*   **AI 聊天体验修复**：修复了 AI 聊天对话框和面板在特定情况下的滚动条异常及输入框焦点丢失问题。

#### 🔧 系统改进

*   **代码架构优化**：重构并格式化了快捷菜单构建与路径处理相关的底层代码，提升了系统稳定性。

---

### English

This release focuses on improving editing continuity and expanding preview capabilities, featuring Markdown TOC generation, editor state persistence, and built-in HTML file preview support.

#### ✨ New Features

*   **Markdown Table of Contents (TOC)**: Now supports automatic TOC generation via `[TOC]` placeholder, featuring a new collapsible structure and optimized styling.
*   **HTML File Preview**: Built-in support for previewing HTML files within the workspace, enhancing the viewing experience for web-related assets.
*   **Editor Cursor Persistence**: Automatically tracks and restores the last cursor position for each file across sessions and tab switches.
*   **Insert Code Block**: Added a new action and keyboard shortcut to instantly insert Markdown code block templates.
*   **Built-in Markdown Manual**: Added an HTML version of the "Markdown: From Beginner to Advanced" guide for quick reference.

#### 💄 Improvements

*   **Paste Shortcut Support**: Standardized system paste shortcuts for menu items.
*   **Window Interaction Optimization**: Refined window display logic during launch and folder opening, and removed redundant unsaved-change prompts when opening new folders.
*   **AI Chat Polish**: Resolved scrolling irregularities and input focus issues in the AI chat dialog and panel.

#### 🔧 System Refinements

*   **Architecture Refactoring**: Cleaned up and refactored core logic for menu building and path handling to improve overall stability.

---

## [v0.2.0] - 2026-03-13

### 中文

本次更新完成了一项重要的架构升级：**AI 文档会话存储从全局迁移至工作区级别**。每个工作区现在在自身目录下独立维护会话记录，彻底隔离不同项目的 AI 对话历史，同时支持旧数据自动迁移。此外本次还带来了文件名处理增强和侧边栏隐藏文件过滤等实用改进。

#### ✨ 新特性

*   **工作区独立 AI 会话存储**：
    *   AI 文档会话记录现在存储于各工作区自身的 `.haomd/doc_conversations.json` 文件中，而非全局统一存储。
    *   不同工作区的 AI 对话历史完全隔离，切换项目时不再产生串扰。
    *   首次启动时自动将旧格式的全局会话数据迁移至新的工作区级格式，无需手动操作。
    *   新增工作区配置缓存管理，提升多工作区场景下的访问性能。
*   **文件名扩展名智能处理**：
    *   新建文件时自动推断扩展名：输入 `demo` → 保存为 `demo.md`，输入 `demo.html` → 保存为 `demo.html`。
    *   自动处理系统对话框可能追加的重复 `.md` 扩展名，避免出现 `demo.md.md`。
*   **侧边栏隐藏文件过滤**：文件树中自动隐藏以 `.` 开头的文件和目录（如 `.haomd`、`.git`），保持工作区视图整洁。

#### 💄 体验优化

*   **编辑器当前行对比度**：提升当前行背景色的对比度，在复杂文档中光标位置更易识别。
*   **预览背景色统一**：将 Markdown 预览的背景色改用 CSS 变量管理，确保与主题配色保持一致。

#### 🔧 系统改进

*   **会话路径解析重构**：优化了文档会话的路径解析逻辑，使其在多工作区环境下更准确、更健壮。
*   **数据迁移支持**：内置工作区配置文件路径从旧格式到新格式的迁移逻辑，确保升级平滑无感知。

---

### English

This release delivers a significant architectural upgrade: **AI document session storage has been migrated from a global store to a per-workspace model**. Each workspace now maintains its own session records in its local directory, fully isolating AI conversation history across projects. Automatic migration from the old global format is included. This release also brings smarter file extension handling and dotfile filtering in the sidebar.

#### ✨ New Features

*   **Per-Workspace AI Session Storage**:
    *   AI document session records are now stored in each workspace's own `.haomd/doc_conversations.json` file, replacing the previous global store.
    *   Conversation history is fully isolated between workspaces — switching projects no longer causes cross-contamination.
    *   On first launch, existing global session data is automatically migrated to the new per-workspace format with no manual steps required.
    *   Added workspace configuration caching for improved performance in multi-workspace scenarios.
*   **Smart File Extension Handling**:
    *   File extensions are now inferred intelligently on save: typing `demo` saves as `demo.md`, while `demo.html` is saved as `demo.html`.
    *   Duplicate `.md` extensions appended by the system file dialog are automatically de-duplicated (e.g., no more `demo.md.md`).
*   **Dotfile Filtering in Sidebar**: Files and directories starting with `.` (such as `.haomd` and `.git`) are now automatically hidden in the file tree, keeping the workspace view clean.

#### 💄 Improvements

*   **Editor Current Line Contrast**: Increased the contrast of the current line highlight, making the cursor position easier to spot in complex documents.
*   **Preview Background Color**: Migrated the Markdown preview background to a CSS variable, ensuring consistent theming across all color schemes.

#### 🔧 System Refinements

*   **Session Path Resolution Refactoring**: Overhauled the document session path resolution logic for greater accuracy and robustness in multi-workspace environments.
*   **Data Migration Support**: Built-in migration handles the transition of workspace configuration file paths from the old format to the new format, ensuring a seamless upgrade experience.

---

## [v0.1.5] - 2026-03-13

### 中文

本次更新聚焦于**文件管理能力的升级**与**编辑体验的细节打磨**，重点带来了文件虚拟文件夹、代码块一键复制、插入表格等实用功能，同时对 AI 聊天界面进行了交互优化，并新增了对 Intel Mac 的正式构建支持。

#### ✨ 新特性

*   **文件虚拟文件夹**：
    *   支持将文件归入虚拟文件夹进行分组管理。
    *   虚拟文件夹支持**折叠/展开**，折叠状态持久化保存，重启后自动恢复。
    *   支持对虚拟文件夹进行**重命名**操作。
    *   文件夹为空时展示友好的空状态提示。
*   **代码块复制按钮**：Markdown 预览中的代码块右上角新增一键复制按钮，点击即可将代码内容复制到剪贴板。
*   **插入表格**：新增在编辑器中快速插入 Markdown 表格的功能。
*   **Markdown 链接下载**：点击 Markdown 中的本地文件链接时，自动触发文件下载，无需手动操作。
*   **保存 AI 历史记录**：新增将当前 AI 对话历史导出/保存为对话文件的功能，并同步优化了编辑器滚动行为。

#### 💄 体验优化

*   **AI 聊天界面布局**：优化了 AI 聊天窗口的整体布局，改进相关状态的持久化逻辑，体验更流畅。
*   **AI 聊天 Markdown 字体**：调整了 AI 回复内容中的 Markdown 字体大小，阅读更舒适。
*   **AI 设置对话框高度**：将最大高度限制调整为 `95vh`，避免在小屏设备上被截断。
*   **编辑器背景色统一**：将编辑器区域背景色统一为深色主题配色，视觉更一致。
*   **剪贴板命令优化**：改进了剪贴板相关命令的处理逻辑，提升操作可靠性。

#### 🔧 系统改进

*   **移除标题栏文件名显示**：去除了窗口标题栏中的当前文件名，界面更简洁。
*   **移除 AI 聊天窗口状态持久化**：AI 聊天窗口的打开/关闭状态不再写入本地存储，减少不必要的状态依赖。
*   **Intel Mac 构建支持**：Release 流程新增 Intel (x86_64) 架构的 DMG 构建，通过在 ARM Runner 上交叉编译实现，Intel Mac 用户现可下载原生版本。

---

### English

This release focuses on **upgraded file management** and **refined editing experience**, introducing file virtual folders, one-click code copy, table insertion, and Markdown link downloads. AI Chat UI has also been improved, and official Intel Mac builds are now available.

#### ✨ New Features

*   **File Virtual Folders**:
    *   Group files into virtual folders for better organization.
    *   Folders support **collapse/expand**, with state persisted across restarts.
    *   Virtual folders can be **renamed** at any time.
    *   An empty-state prompt is shown when a folder contains no files.
*   **Code Block Copy Button**: A one-click copy button now appears in the top-right corner of code blocks in Markdown preview.
*   **Insert Table**: Added a quick-insert action for Markdown tables in the editor.
*   **Markdown Link Download**: Clicking a local file link in Markdown now automatically triggers a file download.
*   **Save AI History**: Added the ability to export/save the current AI conversation history as a file; editor scrolling behavior was also improved alongside this change.

#### 💄 Improvements

*   **AI Chat UI Layout**: Refined the overall layout of the AI Chat window and improved state persistence logic for a smoother experience.
*   **AI Chat Markdown Font Size**: Adjusted the font size of Markdown content in AI responses for better readability.
*   **AI Settings Dialog Height**: Capped max height at `95vh` to prevent cut-off on smaller screens.
*   **Editor Background Color**: Unified the editor area background to the dark theme palette for a more consistent appearance.
*   **Clipboard Command Handling**: Improved clipboard command processing logic for greater reliability.

#### 🔧 System Refinements

*   **Removed Title Bar Filename**: The current filename is no longer displayed in the window title bar, resulting in a cleaner interface.
*   **Removed AI Chat Open-State Persistence**: The AI Chat panel's open/closed state is no longer written to local storage, reducing unnecessary state coupling.
*   **Intel Mac Build Support**: The release pipeline now produces Intel (x86_64) DMG builds via cross-compilation on the ARM runner. Intel Mac users can now download a native binary.

---

## [v0.1.4] - 2026-03-09

### 中文

本次更新聚焦于**编辑体验的全面提升**，重点引入了 Markdown 格式菜单、编辑器字体缩放，并带来了 AI 聊天的多项交互增强（斜杠命令提示、输入历史持久化、会话管理面板），同时完成了 UI 组件的系统性重构。

#### ✨ 新特性

*   **Markdown 格式菜单**：
    *   新增原生菜单栏「Format」菜单，内含标题级别切换（H1–H6）、段落重置和加粗功能。
    *   全套快捷键支持，无需鼠标即可快速设置文档结构。
    *   底层新增 `formatService` 模块，负责标题切换、加粗等格式操作，逻辑与 UI 解耦。
*   **编辑器字体缩放**：
    *   支持通过快捷键实时调整编辑器字体大小（放大 / 缩小 / 重置）。
    *   缩放比例持久化保存至本地存储，下次启动自动恢复。
*   **AI 聊天斜杠命令提示**：
    *   在 AI 输入框中输入 `/` 后，自动弹出可用指令的浮层提示面板。
    *   支持键盘导航选择，体验流畅直观。
*   **AI 聊天输入历史**：
    *   输入框支持按 `↑` 键快速回填上一条指令。
    *   历史记录持久化至本地存储，跨会话可用。
    *   输入 `/list` 命令可打开完整的历史记录弹窗，支持用 `!n` 格式一键回填任意历史条目。
*   **AI Chat 对话框快捷切换**：新增快捷键，可快速切换 AI Chat 面板的显示/隐藏状态。
*   **AI 聊天会话管理面板**：在活动栏新增会话管理入口，可在侧边栏切换历史会话。
*   **原始 HTML 渲染支持**：Markdown 预览器集成 `rehype-raw`，支持在 Markdown 中嵌入原始 HTML 内容。

#### 💄 体验优化

*   **编辑器窗格布局调整**：优化编辑器面板的整体布局与间距比例，阅读与编辑体验更舒适。
*   **AI 设置对话框布局**：调整 AI 设置弹窗的排版与滚动行为，层次更清晰。
*   **编辑器高亮增强**：提升当前行与光标指示器的视觉对比度，减少视觉疲劳。
*   **斜体文本样式优化**：统一了 Markdown 预览中斜体文本的渲染样式。
*   **HTML 导出增强**：导出模板新增内联样式支持，保证导出内容的一致性。

#### 🔧 系统改进

*   **可复用 Button 组件**：将分散的按钮样式提取为统一的 `Button` 组件，支持多种变体（primary / ghost / danger）和图标插槽，在 `ConfirmDialog`、`PromptSettingsDialog` 等处完成替换，UI 一致性显著提升。
*   **文档会话路径重构**：新增 `resolveDocDirForKey` 函数统一处理文档路径归一化，移除 `workspaceId` 作为存储键的冗余依赖，路径逻辑更健壮。
*   **命令注册体系扩展**：`registry.ts` 新增格式化命令与编辑器缩放命令的注册，进一步完善了应用的命令驱动架构。
*   **AI Chat lint 修复**：修正了 AI 输入框在渲染阶段直接读取 `ref` 导致的 `react-hooks/refs` lint 错误，改为通过事件同步光标位置状态。
*   **内联数学标签修正**：修复 Markdown 渲染器中内联数学公式的 HTML 标签名错误问题，确保公式正确渲染。

---

### English

This release focuses on a **comprehensive improvement to the editing experience**, featuring a Markdown Format menu, editor font scaling, and a series of AI Chat interaction enhancements including slash command hints, persistent input history, and a session management panel. It also delivers a systematic refactoring of UI components.

#### ✨ New Features

*   **Markdown Format Menu**:
    *   A new "Format" entry in the native menu bar, providing heading level switching (H1–H6), paragraph reset, and bold formatting.
    *   Full keyboard shortcut support for a mouse-free document structuring workflow.
    *   A new `formatService` module handles heading and bold operations, cleanly decoupled from the UI layer.
*   **Editor Font Scaling**:
    *   Real-time font size adjustment via keyboard shortcuts (zoom in / zoom out / reset).
    *   Scale preference is persisted to local storage and restored on next launch.
*   **AI Chat Slash Command Hints**:
    *   Typing `/` in the AI input box now triggers a floating hint panel listing available commands.
    *   Fully keyboard-navigable for a smooth, intuitive experience.
*   **AI Chat Input History**:
    *   Press `↑` in the input box to instantly recall the previous command.
    *   History is persisted to local storage and remains available across sessions.
    *   The `/list` command opens a full history dialog; use `!n` to paste any historical entry back into the input.
*   **AI Chat Panel Toggle Shortcut**: A new keyboard shortcut to quickly show/hide the AI Chat panel.
*   **AI Session Management Panel**: A new session-management entry in the activity bar lets you browse and switch among historical chat sessions from the sidebar.
*   **Raw HTML Rendering**: The Markdown viewer now integrates `rehype-raw`, enabling raw HTML to be embedded directly in Markdown content.

#### 💄 Improvements

*   **Editor Pane Layout**: Refined overall layout and spacing of the editor panel for a more comfortable reading and writing experience.
*   **AI Settings Dialog Layout**: Improved typography and scroll behavior in the AI settings dialog for better visual hierarchy.
*   **Editor Highlight Contrast**: Increased visual contrast for the current line highlight and cursor indicator to reduce eye strain.
*   **Italic Text Styling**: Unified the rendering style for italic text in Markdown preview.
*   **HTML Export Enhancement**: Added inline style support to the export template for consistent output across environments.

#### 🔧 System Refinements

*   **Reusable Button Component**: Extracted scattered button styles into a unified `Button` component supporting multiple variants (primary / ghost / danger) and an icon slot. Adopted in `ConfirmDialog`, `PromptSettingsDialog`, and more, significantly improving UI consistency.
*   **Document Session Path Refactoring**: Introduced `resolveDocDirForKey` to centralize document path normalization and removed the redundant `workspaceId` dependency from storage keys, making path logic more robust.
*   **Command Registry Expansion**: Registered formatting and editor-zoom commands in `registry.ts`, further strengthening the application's command-driven architecture.
*   **AI Chat Lint Fix**: Resolved a `react-hooks/refs` lint error caused by reading a `ref` during the render phase in the AI input box; cursor position is now synchronized via events instead.
*   **Inline Math Tag Fix**: Corrected an HTML tag name error for inline math formulas in the Markdown renderer, ensuring proper formula rendering.

---

## [v0.1.3] - 2026-03-06

### 中文

本次更新重点引入了全新的**编辑器查找与替换**功能，并同步带来多项 AI 体验提升与系统稳定性改进。

#### ✨ 新特性

*   **查找与替换（Find & Replace）**：
    *   新增编辑器内搜索功能，按 `Cmd + F` 即可唤出弹出式搜索栏。
    *   搜索结果以**高对比度色块**实时高亮：全局匹配项使用亮黄色，当前聚焦的匹配项使用带发光效果的亮蓝色。
    *   支持 **上一个 / 下一个** 跳转（回车 / Shift+回车），同步显示当前匹配序号（如 2 / 7）。
    *   支持**区分大小写**、**全词匹配**、**正则表达式**三种搜索模式。
    *   点击搜索栏左侧的折叠箭头可展开**替换区域**，支持**单个替换**（Enter）和**全部替换**（Cmd+Enter）。
    *   搜索框中的文字输入/粘贴/全选快捷键（`Cmd+V` / `Cmd+A`）完全可用，不受编辑器快捷键干扰。
*   **AI 快捷键优化**：
    *   重新整理了 AI 相关功能的快捷键绑定，确保无冲突且更便于记忆。
*   **退出确认**：退出应用时固定弹出确认对话框，避免误操作丢失未保存的内容。

#### 💄 体验优化

*   **多 Dify Provider 会话隔离**：每个 Dify 服务商现在拥有独立的会话 ID，在不同工作 / 个人 Dify 实例之间切换时再也不会出现串线。
*   **菜单结构精简**：移除了不常用的 Go 菜单，界面更加简洁聚焦。
*   **AI 视觉模式图标**：更新了 AI 聊天中视觉模式图标，识别度更高。
*   **UI 细节统一**：统一了模态框按钮的幽灵 (Ghost) 样式，交互行为更一致。

#### 🔧 系统改进

*   **原生剪贴板支持**：将 Edit 菜单的 Copy / Paste / Cut / Select All 迁移至 Tauri 原生预设菜单（`PredefinedMenuItem`），彻底解决了搜索框及其他输入框中快捷键被拦截的问题。
*   **自定义搜索高亮引擎**：从零构建了独立的 CodeMirror `ViewPlugin`，完全绕开依赖版本冲突，实现逻辑自洽、样式完全可控的高亮渲染，架构遵循开闭原则。
*   **编辑器稳定性**：修复了大型文档场景下因 stale closure 引发的编辑器内容丢失问题。
*   **文档存储路径**：将 AI 会话与文档的关联键更改为两级目录路径，提升了多项目场景下的准确性。

---

### English

This release introduces the all-new **Find & Replace** feature for the editor, along with several AI experience improvements and system stability enhancements.

#### ✨ New Features

*   **Find & Replace**:
    *   Press `Cmd + F` to open a floating search bar within the editor.
    *   All matches are highlighted in real-time with **high-contrast colors**: general matches in bright yellow, and the current focused match in glowing sky blue.
    *   Navigate matches with **Next / Previous** (Enter / Shift+Enter), with a live match counter (e.g., 2 / 7).
    *   Supports **Case Sensitive**, **Whole Word**, and **Regular Expression** search modes.
    *   Clicking the chevron on the left opens a **Replace** row supporting **Replace One** (Enter) and **Replace All** (Cmd+Enter).
    *   Native text editing shortcuts (`Cmd+V`, `Cmd+A`) work as expected inside all search/replace inputs.
*   **AI Shortcut Refinement**: Reorganized AI-related keyboard shortcuts for clarity and conflict-free usage.
*   **Quit Confirmation**: The app now always shows a confirmation dialog on quit, preventing accidental data loss.

#### 💄 Improvements

*   **Per-Provider Dify Session Isolation**: Each Dify provider now maintains its own conversation ID, eliminating session conflicts when switching between work and personal Dify instances.
*   **Streamlined Menu Bar**: Removed the rarely-used Go menu for a cleaner interface.
*   **AI Visual Mode Icon**: Updated the visual mode indicator icon in AI Chat for better recognizability.
*   **Unified Modal Button Styles**: Standardized ghost button styles across all dialogs for a consistent interaction experience.

#### 🔧 System Refinements

*   **Native Clipboard Integration**: Migrated Edit menu items (Copy, Paste, Cut, Select All) to Tauri's `PredefinedMenuItem`, completely resolving shortcut interception issues in text inputs.
*   **Custom Search Highlight Engine**: Built a standalone CodeMirror `ViewPlugin` from scratch, bypassing dependency version conflicts for a fully self-contained, highly controllable highlight rendering layer. Architecture follows the Open/Closed Principle.
*   **Editor Stability**: Fixed an editor content loss issue caused by stale closures in large document scenarios.
*   **Document Storage Path**: Changed the document-session association key to a two-level directory path for improved accuracy in multi-project setups.

---

## [v0.1.2] - 2026-03-04

### 中文

#### ✨ 新特性
*   **AI 聊天增强**：
    *   为 AI 输入框添加了上下文相关的 **占位符提示 (Placeholder)**，提升引导体验。
    *   优化了 AI 设置对话框的布局，交互更加直观。
*   **关于对话框**：全新的“关于”对话框，采用浏览器 API 替代原有方式获取系统信息，提升了兼容性与稳定性。

#### 💄 体验优化
*   **UI 微调**：
    *   优化了关于对话框的样式和类名。
    *   进一步统一了全平台的 UI 样式及交互细节。

#### 🔧 系统改进
*   **代码架构**：全面使用浏览器原生 API 替代部分 Tauri API 获取系统信息，减少了对底层环境的硬性依赖。
*   **工程化**：更新应用版本号并保持工作区管理逻辑的简洁性。

---

### English

#### ✨ New Features
*   **AI Chat Enhancements**:
    *   Added context-aware **placeholders** to the AI chat input for a better guided experience.
    *   Optimized the layout of the AI Settings dialog for more intuitive interaction.
*   **About Dialog**: Redesigned the "About" dialog to use standard Browser APIs for system information, improving compatibility and stability.

#### 💄 Improvements
*   **UI Refinement**:
    *   Refactored styles and class names for the About dialog.
    *   Continued polishing UI styles and interaction details across the app.

#### 🔧 System Refinements
*   **Architecture**: Transitioned to using standard Browser APIs instead of Tauri-specific APIs for system info, reducing dependency on the underlying platform.
*   **Maintenance**: Updated application versioning and maintained clean workspace management logic.


## [v0.1.1] - 2026-03-04

### 中文

感谢使用 HaoMD！在此版本中，重点增强了 **PDF 资源管理**、**AI 会话稳定性**，并对 **UI 细节** 进行了全面打磨。

#### ✨ 新特性
*   **PDF 虚拟文件夹**：新增 PDF 最近浏览文件的虚拟文件夹管理，支持 **折叠、重命名、移动及删除**，助你高效组织文献。
*   **侧边栏目录管理**：支持在侧边栏直接 **新建文件夹** 及 **删除目录节点**，文件组织更加得心应手。
*   **AI 功能增强**：
    *   新增 **Dify 对话日志记录**，方便追溯 AI 交互过程。
    *   重构会话逻辑，确保 **AI 会话历史与文档目录** 的关联高度一致。
*   **性能保障**：为 AI 会话压缩模块添加了完整的测试用例，确保长对话下的系统健壮性。

#### 💄 体验优化
*   **UI 精准打磨**：
    *   优化了工作区布局的滚动行为，交互更顺滑。
    *   微调编辑器 **当前行高亮样式**，视觉层次更清晰。
    *   统一了对话框（ConfirmDialog）按钮的 **幽灵 (Ghost) 样式** 及焦点管理逻辑。
*   **PDF 阅读体验**：全面优化 PDF 阅读器侧边栏的图标、间距及排版。
*   **代码瘦身**：清理了 `estimatedPageHeight`、`dirKey` 等冗余变量，提升应用运行效率。

#### 🐛 问题修复
*   **渲染修复**：修复了 AI 打字机效果在“非流式输出”状态下文字可能被截断的问题。
*   **国际化**：将 PDF 侧边栏的提示信息由中文调整为英文，保持专业界面的一致性。
*   **构建修复**：解决了 v0.1.0 发现的 Linux/macOS 自动打包权限配置问题。

---

### English

Thank you for choosing HaoMD! In this version, the focus was on enhancing **PDF resource management**, improving **AI session stability**, and polishing **UI details**.

#### ✨ New Features
*   **PDF Virtual Folders**: Introduced virtual folder management for recently viewed PDFs. You can now **fold, rename, move, and delete** folders to organize your reference materials efficiently.
*   **Sidebar Directory Management**: Added support for **creating folders** and **deleting directory nodes** directly from the sidebar.
*   **AI Enhancements**:
    *   Added **Dify conversation logging** for better traceability of AI interactions.
    *   Refactored session logic to ensure strict consistency between **AI history and document directory contexts**.
*   **Reliability**: Implemented comprehensive test cases for the AI session compression module to ensure system robustness during long conversations.

#### 💄 Improvements
*   **UI/UX Polishing**:
    *   Optimized scrolling behavior within the workspace layout for a smoother experience.
    *   Refined the **current line highlight style** in the editor for better visual clarity.
    *   Unified the **Ghost style** and focus management logic for buttons in `ConfirmDialog`.
*   **PDF Reading Experience**: Optimized icons, spacing, and typography in the PDF reader sidebar.
*   **Refactoring**: Removed redundant variables like `estimatedPageHeight` and `dirKey` to improve application performance.

#### 🐛 Bug Fixes
*   **Rendering Fix**: Fixed an issue where the AI typewriter effect would truncate text when the "non-streaming" mode was active.
*   **Internationalization**: Changed PDF sidebar prompts from Chinese to English for professional UI consistency.
*   **CI/CD Fix**: Resolved permission issues in automatic packaging discovered in v0.1.0 for Linux and macOS.

## [v0.1.0] - 2026-02-27
- Initial release with core Markdown editing and AI features.
