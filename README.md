# ZenMark (Tauri 2 · React · TypeScript)

跨平台、离线优先的 Markdown 实时预览编辑器原型，基于 Tauri 2 + React + Vite 搭建。目标：高性能大文件编辑、可视化（KaTeX / Mermaid / PlantUML / mind）、标签页、多格式导出、主题与插件体系。

## 开发环境
- Node 18+ / npm
- Rust stable + Cargo

## 快速开始
```bash
cd app
npm install
npm run tauri:dev   # 启动 Tauri 2 桌面调试（需已安装 Rust toolchain）
```

若 tauri 依赖未预装，可先安装 CLI：
```bash
npm install -D @tauri-apps/cli@^2
```

## 脚手架现状
- 前端：Vite + React + TS，初步布局（编辑区 + 预览区）。
- Tauri：已提供 `src-tauri` 目录、配置与基本命令回调 `ping`（后续扩展文件系统/导出/可视化能力）。

## 后续路线（摘自计划）
- 接入 Markdown 渲染管线（统一 remark/rehype 插件策略）及可视化插件注册表。
- 文件读写、自动保存、历史版本与 PDF/HTML/Word 导出。
- 离线渲染安全隔离（PlantUML/mind 本地化），主题/快捷键/插件系统。
- 大文件性能优化与多标签页体验。
