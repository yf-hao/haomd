# 阶段 4 任务拆解（文件系统与历史版本，符合高质量代码要求）

## 契约与配置
- 明确 TS/Rust 数据模型与错误码：`FilePayload`/`WriteResult`/`RecentFile`/`SnapshotMeta` 字段、单位（mtime 精度）、hash 算法（SHA-256）、编码（UTF-8）。
- 完善 `config/files.ts`：历史目录、容量/数量上限、autoSave（debounce/idle）、冲突策略、日志字段。

## 后端（Tauri）
- 命令：`read_file` / `write_file`（expected_mtime/hash 冲突检测）/ `list_recent` / `make_snapshot` / `list_snapshots` / `restore_snapshot`。
- 安全与健壮：路径规范化防跳目录、大小上限、历史目录 + manifest 维护、并发写锁、trace_id 生成与日志落盘/旋转策略。
- 测试：IO 正常/超限/冲突/历史溢出/恢复，基于临时目录的集成测试。

## 前端服务层
- `modules/files/service.ts`：封装命令、错误码映射、trace 透传。
- 最近列表管理（含清空）、哈希/mtime 传递、自动保存 hook（debounce/idle）。
- 冲突处理：标准 Result，抛出 `CONFLICT` 供 UI 弹窗。

## UI 与状态
- 全局文件状态：path、dirty、lastSaved、history 列表、auto-save 状态。
- 顶部状态区：文件名+脏标记，自动保存中/失败提示。
- 历史面板：列表、预览（可先纯文本 diff）、恢复按钮。
- 冲突弹窗：保存/不保存/取消；失败回退路径。
- 最近文件入口（下拉/侧栏）。

## 菜单与快捷键（含 AI 菜单，占位可提示）
- File：Open / Open Folder / Open Recent / Save / Save As / Close File / Quit。
- Edit/View/Selection/Go/Help/AI：定义事件名与快捷键；未实现动作给占位提示。
- Dispatcher：菜单事件 → 脏检查/保存对话/打开/最近/AI 面板。

## 错误与降级
- 文件系统不可用 → 只读模式提示。
- 历史目录超限 → 错误码 + 清理建议。
- 自动保存失败 → 重试入口 + 上限/退避。
- AI 密钥存储安全策略（Tauri secure storage 或加密文件）。

## 测试与验收
- 用例：打开/保存/超限/冲突/自动保存/历史溢出与清理/恢复成功/菜单与快捷键。
- 冒烟：`npm run build`、`npm run tauri:dev`；日志含 trace_id 可追踪。



待办列表
1.补全 TS/Rust 数据模型与错误码枚举（FilePayload/WriteResult/RecentFile/SnapshotMeta）
2.完善 config/files.ts：历史目录/容量上限/autoSave/冲突与日志字段
3.实现 Tauri 文件命令与安全策略（read/write/list_recent/snapshot/restore + 路径规范化/并发锁/trace 日志）
4.落地前端 file service 与自动保存、冲突处理、最近列表管理
5.完善文件状态与 UI：文件名+脏标记、历史面板、冲突弹窗、最近入口
6.定义菜单/快捷键含 AI 菜单，前端 dispatcher 脏检查与占位提示
7.制定错误与降级策略（只读模式、历史超限清理、自动保存重试、AI 密钥存储）
8.编写测试与验收用例（超限/冲突/历史溢出/菜单快捷键）并跑冒烟