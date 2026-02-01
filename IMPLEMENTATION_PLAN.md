# ZenMark 实施计划（迭代式）

## 目标与基线
- 跨平台桌面端（Tauri 2.9.x + React + Vite + TS），离线优先。
- Markdown 实时预览，支持 KaTeX / Mermaid / PlantUML / mind 插件化渲染。
- 本地文件读写、自动保存、历史版本；导出 PDF/HTML/Word。
- 性能优化：大文件渲染、输入时延、预览同步；支持多标签页。
- 主题系统、快捷键、可插拔扩展。

## 阶段 1：环境与依赖对齐（可落地步骤）
1. **确认版本号（前后端一致）**
   - 前端：`@tauri-apps/api` 与 `@tauri-apps/cli` 设为 `2.9.5`（或同一 2.9.x）
   - Rust：`tauri` 与 `tauri-build` 设为 `2.9.5`（或同一 2.9.x）
   - 避免跨次小版本混用（如 2.5.x vs 2.9.x）

2. **更新前端依赖声明**
   - 编辑 `app/package.json`：
     - `dependencies.@tauri-apps/api` → `2.9.5`
     - `devDependencies.@tauri-apps/cli` → `2.9.5`
   - 保存文件。

3. **更新后端依赖声明**
   - 编辑 `app/src-tauri/Cargo.toml`：
     - `tauri-build = "2.9.5"`
     - `tauri = "2.9.5"`
   - 保存文件。

4. **清理旧锁与缓存**
   - 删除旧锁：`rm -f app/src-tauri/Cargo.lock`
   - 清理构建缓存：`cargo clean --manifest-path app/src-tauri/Cargo.toml`

5. **重新安装前端依赖**
   - `cd app`
   - `npm install`

6. **验证版本一致性（可选但推荐）**
   - 前端：`npm ls @tauri-apps/api @tauri-apps/cli`
   - 后端：`cargo tree -i tauri`（确认 tauri/tauri-build 版本均为 2.9.5）

7. **启动开发模式**
   - 仍在 `app` 目录：`npm run tauri:dev`
   - 若遇版本不匹配错误，重复步骤 1~6，确保锁文件已重建。

8. **问题排查指南**
   - 找不到 Cargo.toml：确保命令带 `--manifest-path app/src-tauri/Cargo.toml` 或先 `cd app/src-tauri`
   - 版本 mismatch：确认 package.json 与 Cargo.toml 均为同一 2.9.x，重新装依赖并清理 Cargo 缓存。
   - 仍失败：收集完整 `npm run tauri:dev` 输出及 `src-tauri/target` 下的构建日志，再行排查。

## 阶段 2：Markdown 渲染管线与插件架构
- [ ] 建立 `react-markdown + remark-gfm + remark-math + rehype-katex + rehype-highlight` 渲染链。
- [ ] 统一 `code` 组件分派：Mermaid → 前端渲染；PlantUML/mind → 通过接口占位，后续调用后端。
- [ ] 定义插件注册表接口（可扩展自定义 renderer / remark/rehype 插件）。

## 阶段 3：可视化（Mermaid / PlantUML / mind / KaTeX）
- [ ] Mermaid：前端安全配置（`securityLevel: strict`），错误回退与重试。
- [ ] KaTeX：公式块/行内渲染，错误提示。
- [ ] PlantUML：Tauri 后端调用本地 jar + Graphviz 渲染为 SVG/PNG，前端接收 base64/SVG；离线缓存。
- [ ] mind：支持导入 `.mind` 或 JSON AST，后端解析为 SVG/PNG，前端展示；错误提示。

## 阶段 4：文件系统与历史版本
- [ ] 接入 Tauri FS API：打开/保存、最近文件列表、修改提示。
- [ ] 自动保存（节流/防抖）、本地快照（如基于文件哈希的版本目录）。
- [ ] 历史版本查看/恢复（简单 UI）。

## 阶段 5：导出能力
- [ ] HTML：前端直接导出。
- [ ] PDF：调用后端（print-to-pdf 或 puppeteer/ wkhtmltopdf 替代方案）。
- [ ] Word：使用后端工具链（如 pandoc 或 docx 生成），前端触发命令并提供下载。

## 阶段 6：多标签页与状态管理
- [ ] 设计 tab store（Zustand/Redux 任一）支持多文档状态、脏标记、当前 tab。
- [ ] 跨 tab 预览同步与滚动定位（观察者/事件总线）。
- [ ] 快捷键：切换标签、保存、导出、命令面板占位。

## 阶段 7：主题、布局与可插拔扩展
- [ ] 主题变量（light/dark）与局部样式覆写。
- [ ] 插件入口：渲染插件、快捷键扩展、主题包注册机制。
- [ ] 配置持久化（本地配置文件或数据库）。

## 阶段 8：性能与健壮性
- [ ] 大文件分片渲染/虚拟化，滚动同步优化。
- [ ] 输入节流、防抖、异步任务超时与中断（前端）；长任务放后端执行。
- [ ] 错误处理：前后端校验、文件大小限制、渲染失败回退。

## 阶段 9：打包与验证
- [ ] `npm run build` + `npm run tauri:build` 多平台产物（dmg/msi/deb/appimage）。
- [ ] 冒烟测试：打开/保存、导出、可视化、主题切换、多标签。
- [ ] 文档：开发指南、运行/打包步骤、已知问题。

## 里程碑验收标准
- 预览可正确渲染 Markdown/KaTeX/Mermaid；PlantUML/mind 调用后端返回可视化占位或图片。
- 文件读写、自动保存与历史版本可用；导出至少 HTML/PDF 可用。
- 多标签、主题、快捷键、基础插件接口可用；大文件下输入/预览无明显卡顿。
