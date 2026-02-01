# 阶段 3：可视化（Mermaid / PlantUML / mind / KaTeX）实施计划

## 目标
- 在现有渲染管线上，完善可视化能力：Mermaid 前端渲染可配置；PlantUML/mind 通过 Tauri 后端离线渲染；KaTeX 保持稳定。
- 设计高内聚、低耦合的渲染服务接口与安全沙箱，易于扩展与维护。

## 设计准则（高内聚、低耦合、可扩展、可维护）
- **接口分层**：前端渲染器/占位层 ↔ 后端渲染命令/服务接口 ↔ 配置/安全策略分离。
- **开闭原则**：新增/替换 renderer 通过注册表与配置，不改核心分派逻辑。
- **单一职责**：前端仅负责 UI/调用、后端负责渲染与安全校验；配置集中在 config，避免散落常量。
- **安全与沙箱**：后端命令白名单、超时、输入大小限制；前端不信任输入，必要时做过滤/转义。
- **可测试性**：提供最小冒烟用例与后端接口的模拟/降级路径。

## 任务分解（可执行步骤）
1. **配置与常量落地**
   - 新建/完善 `src/config/renderers.ts`：
     - Mermaid 配置（theme/securityLevel/font）；
     - PlantUML/mind 后端命令名、超时、输入大小/类型限制；
     - 启用开关 `enabledRenderers`。

2. **后端接口定义（Tauri 命令）**
   - 在 `src-tauri/src/main.rs` 定义命令：
     - `render_plantuml(puml: String) -> Result<String>`：返回 SVG base64 或 plain SVG。
     - `render_xmind(path_or_json: String) -> Result<String>`：返回 SVG/PNG base64。
   - 封装到 `commands` 模块，暴露给前端，错误返回统一格式（带 code/message）。

3. **后端实现（离线渲染）**
   - PlantUML：调用本地 jar 或二进制（命令从配置读取），以临时文件方式渲染为 SVG/PNG；加超时与输入大小限制。
   - mind：
     - 方案 A：调用内置渲染器/工具（若有 CLI），输出 SVG/PNG。
     - 方案 B：解析 mind JSON AST，生成 SVG（可选第三方库）。
   - 安全：路径白名单/扩展名校验，禁止任意命令；使用 `tokio::process` 加超时。

4. **前端调用层（服务模块）**
   - 新建 `src/modules/visualization/service.ts`：
     - `renderPlantUML(code): Promise<string>` 调 Tauri 命令；错误返回占位。
     - `renderXMind(codeOrPath): Promise<string>` 同上。
     - 使用配置开关决定是否启用后端调用，否则降级为占位。

5. **渲染器集成**
   - 在 `diagrams.tsx`：
     - PlantUML：调用 service 获取 SVG，loading/错误状态显示；保留占位作为降级。
     - mind：同上。
   - 在 `MarkdownViewer` 的 code 分派中，继续通过注册表获取 renderer（保持开闭）。

6. **错误与降级处理**
   - 前端：渲染错误时显示占位+错误信息，不阻塞其他内容。
   - 后端：超时/格式错误/执行失败返回标准错误结构；记录日志（tauri-plugin-log）。

7. **测试与验收**
   - Seed 覆盖：Mermaid、KaTeX、PlantUML、mind 示例（含无效 UML/无效 mind 的错误提示验证）。
   - 冒烟流程：
     ```bash
     npm run build
     npm run tauri:dev
     ```
   - 验收点：
     - Mermaid/KaTeX 正常渲染；
     - PlantUML/mind 在后端开启时返回可视化；关闭或出错时显示占位并提示；
     - TS 0 error；无控制台致命错误；后端日志无未处理 panic。

## 质量与安全补充（根据评估）
- **统一错误模型与类型**：前后端统一 `{ code: string; message: string }`，前端 service Promise 显式返回类型，避免 `any`。
- **日志与可观测性**：约定后端日志位置（tauri-plugin-log），前端 console 过滤策略；错误结构统一便于排障。
- **降级策略细化**：PlantUML/mind 后端不可用时的 UX 规范（占位文案 + 重试提示/按钮预留），保证不出现空白区域。
- **安全细节**：文档写清允许扩展名、最大输入/文件大小、命令路径配置方式，避免环境差异；命令白名单、超时、并发/队列策略写入配置与实现。
- **性能预留**：并发与超时后的清理行为明确；可选懒加载/按需渲染可视区域，防止长任务堆积。

## 后续衔接
- 阶段 4 将继续完善文件系统/历史版本，阶段 5 实现导出，阶段 8 做性能与安全加固。
