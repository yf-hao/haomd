# 阶段 3 实施步骤（可视化：Mermaid / PlantUML / XMind / KaTeX）

## 设计准则
- 分层与单一职责：前端渲染/调用层 ↔ 后端命令/渲染层 ↔ 配置/安全策略分离。
- 开闭与可扩展：renderer 通过注册表/配置开关接入，新增不改核心分派。
- 安全与健壮：命令白名单、超时、输入/文件大小限制，统一错误模型与降级。
- 可测试性：明确 seed 覆盖、冒烟流程、错误提示验证。

## 实施步骤
1) **配置与常量落地**
   - 更新/完善 `src/config/renderers.ts`：
     - Mermaid：`securityLevel/theme/fontFamily`。
     - PlantUML/XMind：命令名、命令路径（如需）、超时、输入大小/文件类型白名单。
     - 并发与队列：`maxConcurrentPerRenderer`（建议默认 2）、`queueSize`（默认 20）、`queueStrategy`（如 `drop_tail`/`reject`/`cancel_oldest`），`timeoutMs`，重试开关/最大次数/退避间隔常量（预留）。
     - 启用开关：`enabledRenderers = { mermaid, plantuml, xmind, katex }`。
   - 统一错误模型定义：`{ code: string; message: string }`。
   - 日志常量：约定后端日志文件位置，统一 JSON Lines 字段：`timestamp`、`level`、`renderer`、`action`、`duration_ms`、`outcome`、`code`、`message`、`trace_id`。

2) **后端命令定义（Tauri）**
   - 在 `src-tauri/src/main.rs`/`commands.rs` 增加：
     - `render_plantuml(puml: String) -> Result<String, ErrorStruct>`（SVG 或 base64）。
     - `render_xmind(input: String) -> Result<String, ErrorStruct>`（SVG/PNG base64）。
   - 错误结构对齐前端模型，使用 `tauri::command` 暴露。

3) **后端实现与安全**
   - PlantUML：调用本地 jar/二进制（命令取自配置），写临时文件，渲染为 SVG/PNG，超时与输入大小限制，扩展名校验。
   - XMind：
     - 方案 A：调用 CLI 渲染为 SVG/PNG；
     - 方案 B：解析 JSON AST 生成 SVG；
     - 同样做扩展名/大小校验与超时。
   - 并发/队列：以 `tokio::Semaphore` 限流；超出 `maxConcurrentPerRenderer` 时进入有界队列（长度 `queueSize`），按 `queueStrategy` 决定排队/拒绝/取消最旧，排队等待和拒绝都记录日志与错误码（如 `QUEUE_FULL`）。
   - 重试（若实现）：仅对可重试错误（如超时/临时 IO 失败）进行最多 N 次（配置），退避间隔递增；重试需幂等（相同输入写入同一路径），并在日志中附带尝试序号。
   - 进程调用：使用 `tokio::process` + 超时；命令白名单，严格传入工作目录/参数；异常时清理临时文件。

4) **前端服务层**
   - 新建 `src/modules/visualization/service.ts`：
     - `renderPlantUML(code): Promise<Result>` 调 Tauri 命令，返回 `{ ok: true, data }` 或 `{ ok: false, error }`。
     - `renderXMind(input): Promise<Result>` 同上。
     - 根据 `enabledRenderers` 决定启用/降级；为每次调用生成 `trace_id`，透传给后端与日志；预留重试参数（次数/退避）以便 UI 触发重试时复用。

5) **渲染器集成与降级**
   - 在 `diagrams.tsx`：
     - PlantUML/XMind 调用 service，loading/错误状态显示；若处于队列等待，文案显示“队列中…（可取消）”；超时/可重试错误时显示重试按钮，点击触发新请求并生成新的 `trace_id`。
     - 重试交互：请求中按钮置灰；超过最大重试次数或检测到不可重试错误（如校验失败）时显示“请稍后再试/联系支持”。
     - 保留 Mermaid/KaTeX 现有逻辑（Mermaid 前端渲染，KaTeX 由 rehype-katex）。
   - `MarkdownViewer` 依旧通过注册表分派 renderer，保持开闭。

6) **日志与可观测性**
   - 后端：使用 `tauri-plugin-log` 输出 JSON Lines，字段包含：`timestamp`、`level`、`renderer`、`action`（如 enqueue/exec/retry/timeout）、`duration_ms`、`outcome`（success/queued/rejected/failed）、`code`、`message`、`trace_id`；日志文件位置写入文档，便于排障。
   - 前端：统一错误结构，过滤已处理/可预期错误，仅输出 fatal/未处理；在控制台打印 `trace_id` 便于后端对齐。

7) **测试与验收**
   - Seed：Mermaid、KaTeX、PlantUML、XMind，包含无效 UML/XMind 以验证错误提示与错误码；加入并发/队列场景（超过并发与队列上限）。
   - 冒烟：`npm run build`、`npm run tauri:dev`，检查 TS 0 error、控制台无致命错误、后端日志无 panic。
   - 验收：
     - Mermaid/KaTeX 正常渲染。
     - PlantUML/XMind 后端开启时返回可视化；关闭/失败时显示占位与错误文案；重试可用（若实现），重试按钮灰度与次数限制生效。
     - 并发/队列：超过并发数时请求排队，队列满时按策略拒绝并返回错误码；日志包含 enqueue/execute/timeout/retry 记录与 `trace_id` 对齐。

## 交付物
- 配置文件更新（renderers.ts，含安全/超时/并发/白名单）。
- 后端命令实现与错误模型对齐。
- 前端 service 与 diagrams 集成、降级提示。
- 测试说明与 seed 覆盖。
