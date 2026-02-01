# 阶段 2：Markdown 渲染管线与插件架构实施步骤

## 目标
- 建立统一渲染管线：`react-markdown + remark-gfm + remark-math + rehype-katex + rehype-highlight`。
- 自定义 `code` 组件分派：Mermaid 前端渲染；PlantUML/XMind 占位（后端接口预留）。
- 搭建可扩展的渲染插件注册表（便于未来扩展 renderer 或 remark/rehype 插件）。

## 设计准则（高内聚、低耦合、可扩展、可维护）
- **分层与接口隔离**：渲染管线（remark/rehype）、可视化 renderer（mermaid/plantuml/xmind）、宿主 UI（App）三层，彼此通过明确 props/接口交互。
- **策略/工厂模式**：`code` 渲染分派使用策略/注册表，新增 renderer 只需注册，不改核心逻辑（开闭原则）。
- **可替换实现**：Mermaid 采用适配器封装，PlantUML/XMind 先占位，后端实现可无侵入替换。
- **单一职责**：`MarkdownViewer` 只负责组装管线与分派，`diagrams.tsx` 只负责具体 renderer，样式放在 CSS。
- **错误隔离**：渲染异常兜底（占位/错误提示），避免阻塞整体预览。

## 任务分解（细化执行）
1. **依赖补充**（如未安装）
   ```bash
   cd /Users/yfhao/Documents/study/markdown/app
   npm install react-markdown remark-gfm remark-math rehype-katex rehype-highlight mermaid katex highlight.js plantuml-encoder
   ```

2. **创建渲染组件（高内聚：渲染只在此处处理）**
   - 新建 `src/components/MarkdownViewer.tsx`：
     - 引入 `ReactMarkdown`，配置 `remarkPlugins=[remarkGfm, remarkMath]`、`rehypePlugins=[rehypeKatex, rehypeHighlight]`。
     - 自定义 `components.code`：解析 className 提取语言，分派到 renderer（mermaid / plantuml / xmind），否则渲染高亮 code block。
     - 导出纯展示组件 `MarkdownViewer({ value })`，不处理业务状态。
   - 新建 `src/components/diagrams.tsx`：
     - `MermaidBlock`：`mermaid.initialize({ startOnLoad:false, securityLevel:'strict', theme:'dark' })`；useEffect 调用 `mermaid.render`，错误时显示 `diagram-error`。
     - `PlantUMLBlock`：使用 `plantuml-encoder` 仅展示校验/摘要，占位提示“后端渲染待接入”。
     - `XMindBlock`：展示占位文本 + 代码片段，提示“后端解析待接入”。

3. **全局样式支持（低耦合：样式集中在 CSS）**
   - 在 `src/App.tsx` 顶部引入：`katex/dist/katex.min.css`、`highlight.js/styles/atom-one-dark.css`。
   - 在 `src/App.css` 增加：`.markdown-body`、`.code-block`、`.diagram-block/.diagram-header/.diagram-error/.diagram-placeholder` 等样式，避免散落行内样式。

4. **页面集成（可扩展：仅挂载组件与种子数据）**
   - 在 `src/App.tsx`：
     - 引入 `MarkdownViewer`，移除旧的 `dangerouslySetInnerHTML` 逻辑。
     - `seed` 文本改为数组 join，包含 KaTeX/mermaid/plantuml/xmind 示例代码块，防止模板字符串反引号冲突。
     - 保持 App 仅管理状态（`markdown`）、布局和按钮占位，不处理渲染细节。

5. **插件注册表占位（后续扩展接口，开闭原则）**
   - 预留 `src/modules/markdown/plugins.ts`：
     - 定义 `type Renderer = (code: string) => ReactNode`；
     - `registerRenderer(type, renderer)`、`getRenderer(type)`；
     - 默认注册 mermaid/plantuml/xmind/katex（可在后续阶段实现）。

6. **验证与调试**
   - 运行：
     ```bash
     cd /Users/yfhao/Documents/study/markdown/app
     npm run dev       # 仅前端
     # 或 npm run tauri:dev  # 启动桌面端
     ```
   - 检查：
     - Markdown 基础、GFM、KaTeX 渲染正确；代码高亮生效。
     - Mermaid 显示 SVG；错误时有提示不阻塞。
     - PlantUML/XMind 占位渲染，无前端异常。

7. **验收标准（可维护性量化）**
   - `npm run build` 无错误；TypeScript 0 error。
   - 渲染代码集中于 `MarkdownViewer`/`diagrams.tsx`，App 未出现渲染逻辑耦合。
   - 新增 renderer 仅需注册，不改动现有分派逻辑。

## 类型约束与配置化补充
- **类型约束**：
  - `Renderer = (code: string) => React.ReactNode`；`RendererMap = Record<string, Renderer>`；注册表 API：`registerRenderer(type: string, renderer: Renderer)`、`getRenderer(type: string)`。
  - Mermaid/PlantUML/XMind props 定义 `{ code: string }`，禁止 `any`；错误状态用 `string | null`。
  - 组件 props 使用只读与可选：`Readonly<{ value: string }>`，减少可变引用。
  - 前端 service/后端命令的错误模型统一：`{ code: string; message: string }`，Promise 返回类型显式化。
- **配置化与安全细节**：
  - 创建/完善 `src/config/renderers.ts`：启用开关 `enabledRenderers`，Mermaid 的 `securityLevel/theme/fontFamily`；PlantUML/XMind 的命令名、超时、输入大小/文件类型白名单、命令路径。
  - 记录命令执行超时/并发上限策略（防任务堆积），写入配置常量与文档。
- **日志与可观测性**：
  - 约定后端日志位置（tauri-plugin-log），前端控制台过滤策略；错误返回统一结构，便于排障。
- **降级体验**：
  - PlantUML/XMind 后端不可用时的文案规范（占位 + 重试提示/按钮预留），避免空白。
- **测试钩子与验证用例**：
  - Seed 覆盖：基础 markdown、GFM 表格、KaTeX 块/行内、Mermaid、PlantUML 占位、XMind 占位，含无效 UML/XMind 错误提示验证。
  - 手动冒烟脚本：
    ```bash
    npm run build   # 确认 TS 0 error
    npm run dev     # 前端预览检查各块渲染
    # npm run tauri:dev # 桌面端可选
    ```
  - 断言点：Mermaid 显示 SVG 且无控制台致命错误；PlantUML/XMind 显示占位或渲染结果；公式正常渲染；代码高亮可见。
- **性能与扩展预留**：
  - 文档标注后续可插拔的虚拟滚动/分片解析开关（阶段 8 接入），接口保持不变。
  - 注册表与配置文件落地：尽早创建 `src/modules/markdown/plugins.ts` 与 `src/config/renderers.ts`，用实际类型导出，减少后续迁移成本。

## 后续衔接（进入阶段 3/4 时用）
- 将 PlantUML/XMind 的占位替换为 Tauri 后端命令调用（本地 jar/Graphviz 或 XMind 解析）。
- 在插件注册表中增加动态加载与配置开关，支持自定义 renderer 与 remark/rehype 插件。
