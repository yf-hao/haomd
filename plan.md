## 用户需求

- 设计类似 Typora 的 Markdown 编辑器，实时预览，性能优先，跨平台（桌面为 Tauri2）。
- 功能：本地文件读写、自动保存、历史版本；标签页多文档；导出 PDF/HTML/Word；离线运行。
- 可视化：支持 KaTeX、Mermaid、PlantUML（离线渲染）、XMind。
- 体验：实时预览同步、大文件渲染和输入低延迟；主题系统、快捷键、可插拔扩展/自定义样式。

## 设计原则与模式

- 目标：可维护、可扩展、高内聚低耦合、一致性、健壮性。
- 模块与模式：
  - 核心编辑与渲染：采用策略模式/责任链（remark/rehype 插件管线）、命令模式（撤销/重做）、观察者（滚动/光标同步）。
  - 插件与可视化：注册表 + 工厂模式加载 renderer，接口隔离保证替换；适配器封装第三方可视化（katex/mermaid/plantuml/xmind）。
  - 存储与导出：仓储模式封装文件/历史版本；导出采用命令队列，失败重试。
  - UI/状态：Zustand store 分片管理，Presenter/Container + 纯组件保持一致性；主题/快捷键用配置驱动。
- 健壮性：前后端输入校验、格式与大小限制；长任务落后台（Tauri command + async），前端并发防抖 + 超时。

## 技术选型

- 桌面容器：Tauri 2（Rust 后端 + 前端 WebView），跨平台。
- 前端：React + TypeScript + Vite + Tailwind CSS + shadcn/ui；状态管理使用 Zustand。
- Markdown 渲染：remark/rehype 管线 + unified；代码高亮用 Shiki；数学公式用 KaTeX；Mermaid 原生；PlantUML 采用 wasm 本地渲染或内置离线 Jar 调用（由 Tauri 后端执行）；XMind 采用本地嵌入式 Web 组件/SDK（离线包）。
- 文件与存储：Tauri FS API + 本地缓存（IndexedDB）做自动保存与历史版本；导出 PDF/HTML/Word 通过 Tauri 后端（PDF/Word 可用 headless chromium/LibreOffice 调用或前端 html-to-pdf/Docx 生成）。
- 性能：增量渲染（虚拟滚动）、节流/防抖输入、分片解析、预览懒加载；Tab 间资源复用。
- 安全/离线：禁用外部网络依赖，PlantUML 离线资源内置；XMind 组件本地打包。

## 架构方案

- 分层：UI（React 组件）/ 编辑内核（markdown 解析与增量渲染）/ 可视化插件（katex/mermaid/plantuml/xmind）/ 持久化与导出（Tauri commands）。
- 插件化：统一可视化适配层，按类型注册 renderer；主题/快捷键/扩展通过配置驱动。
- 通信：前端调用 Tauri commands 进行文件读写、导出、历史版本管理；保持主线程无阻塞。

## 目录结构（新建/修改）

- /src-tauri/ # [NEW] Tauri 2 后端（Rust）：fs 操作、导出、PlantUML 离线渲染、历史版本存储。
- /src/ # [NEW] 前端 React 源码
- app/ # 路由与布局
- components/editor/ # 编辑器、预览、分屏、工具栏、Tab
- modules/markdown/ # remark/rehype 管线、增量渲染
- modules/visualization/ # katex/mermaid/plantuml/xmind 适配层
- modules/history/ # 自动保存与版本管理（IndexedDB + Tauri）
- modules/export/ # 导出服务（调用 Tauri）
- styles/ # Tailwind/shadcn 主题
- hooks/ # 快捷键、主题、性能优化相关 hooks
- /public/ # [NEW] 离线资源（字体、PlantUML wasm/jar、XMind SDK 静态资源）

## 设计方案

- 布局：左右分栏（可拖拽），左侧编辑，右侧实时预览；顶部命令栏 + 标签页，底部状态栏。
- 主题：深浅色双主题，玻璃拟态 + 微渐变；高对比与可读性优先。
- 交互：平滑滚动、光标同步定位、悬浮工具条、快捷键提示；可视化块悬浮操作区。
- 响应式：桌面优先，收窄时切换分屏/单屏预览切换。
