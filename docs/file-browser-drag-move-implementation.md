# File Browser 拖拽移动：实现与验证

## 已实现行为

- 将单个文档拖到 File Browser 的真实目录或根目录行，完成磁盘移动；同目录放下不执行移动。虚拟分组不作为磁盘目标。
- 重名自动追加 `01`、`02` 等编号，位于最后一个扩展名前；并发占用候选名称时重新规划引用和名称，不覆盖已有文件。
- 附件保留原位置。调整 Markdown 图片、行内/引用式链接和 HTML 的 `src`、`href`、`poster`、`srcset` 地址；保留正文格式、标题、查询参数和锚点，不改写代码和公式。
- 只读取和调整被移动文件自身的引用，不扫描工作区，不自动改写其他文档中的入站链接。
- 保留标签 ID、未保存文字和未保存标记；同步被移动文件对应标签的文件版本。移动与保存共用操作队列，移动后保存不会重新创建旧文件。
- 同步源码编辑器及实时编辑器的链接和撤销/重做历史。移动期间继续输入的内容在提交界面状态时重新读取。
- 拖拽支持目标高亮、悬停展开、边缘滚动和取消；普通点击仍可打开文件。
- 更新文件树、独立文件、虚拟分组归属、最近文件及搜索索引。文件树仅复制受影响分支，并忽略过期刷新结果；移动后不递归刷新根目录。

## 职责划分

| 职责 | 实现 |
| --- | --- |
| 指针手势、目标命中与取消 | `app/src/hooks/useFileTreeDragDrop.ts`，仅依赖移动回调 |
| 移动顺序、重试与界面提交时机 | `app/src/modules/files/application/moveWorkspaceFile.ts` |
| 文件能力契约及 Tauri 适配 | `files/ports/fileMovePort.ts`、`files/adapters/tauriFileMovePort.ts` |
| 保存/移动顺序协调 | `modules/document/documentOperationCoordinator.ts`，用例依赖队列接口 |
| 引用解析、地址迁移与精确补丁 | `modules/markdown/references/` |
| 后台链接分析 | `workers/fileRelocation.worker.ts` |
| 编辑历史迁移 | `components/Editor/relocateDocument.ts`、`components/Wysiwyg/relocateDocument.ts` |
| 磁盘校验、命名、提交和恢复 | `app/src-tauri/src/file_move.rs` |

手势与文件系统各自负责独立工作；新增入口可复用移动用例。文件端口和队列由装配层注入，测试端口遵守相同成功/失败契约。端口只暴露 prepare/commit/cancel，避免界面依赖整个文件服务，落实单一职责、开闭、里氏替换、接口隔离和依赖倒置原则。

## 数据一致性与预览

后端先确定目标名称并读取源文件版本，提交时只校验源文件快照，准备目标文件和恢复日志。目标使用硬链接排他发布，避免覆盖并发出现的目标；完成目标写入后再删除源文件。普通文件写入与移动使用相同的路径锁，路径别名共享锁。

准备阶段不接收扫描根目录，返回的文档快照只有源文件；前端也拒绝包含其他文档的计划。源文件、目标目录必须存在，失败时在错误中标明操作和具体路径。其他文件不存在、无法解码或发生变化均不影响本次移动。

提交失败会尝试补偿；遇到外部修改时保留恢复材料，避免用旧内容覆盖外部修改。启动时处理未完成日志，继续兼容旧版多文档恢复记录。已提交移动的附属记录同步失败会返回需要同步的状态，保留日志供下次启动重试。

只迁移源文件对应标签的内容、保存版本和编辑历史。若当前编辑的是其他文件，保留其编辑器内容和预览任务，不重新应用该编辑器的快照。

不增加输入或预览防抖。拖拽坐标不进入编辑器状态；磁盘文档的链接分析只在放下后通过 Worker 执行。异步预览结果携带对应文件基址，防止旧正文与新目录混用。图片预览和 Word 导出统一解析本地 URL，避免空格、中文、百分号重复编码。

## 验证

此前完整回归基线：前端 143 个测试文件、729 项测试通过，Rust 90 项通过、2 项依赖外网的测试跳过。本次取消扫描后，相关前端测试首轮 36 项通过，补充计划范围校验后对两个相关测试文件复测 11 项通过；原生移动测试 10 项通过（手动性能测试另行执行通过），TypeScript 检查和生产构建通过。浏览器的源码/实时编辑模式分别通过干净文档、移动期间输入、移动后台文件三种场景，共 6 种。具体运行方式见下方脚本。

本机调试构建夹具包含 300 个 Markdown 文档和 2000 个附件：准备阶段原先三次耗时为 1030/1105/1081 ms，取消扫描后为 7/0/0 ms（毫秒取整）。这是本地夹具的准备阶段耗时，不代表完整移动或其他设备的耗时。

在 `app` 目录执行：

```sh
bun run test:run
bun run build
```

在 `app/src-tauri` 目录执行：

```sh
cargo test --lib
```

原生单元测试覆盖编号、不覆盖目标、源文件并发修改、无关文档变更不阻塞移动、拒绝其他文档补丁、路径别名共享锁、回滚、发布后尚未写入完成标记的恢复，以及旧版本保存不能重建已移动文件。

浏览器集成脚本使用生产构建、实际 Sidebar/编辑器/预览及实际链接分析 Worker，原生文件端口使用内存夹具，不读写用户文件。覆盖鼠标拖拽、编号、移动期间输入、保存版本、未保存标记、图片加载与链接目标。需要 Playwright Core 和 Chrome；可通过 `PLAYWRIGHT_MODULE`、`CHROME_PATH` 指定本机位置。

```sh
node scripts/test-file-move-browser.mjs
MOVE_CLEAN=1 node scripts/test-file-move-browser.mjs
MOVE_EDITOR=wysiwyg node scripts/test-file-move-browser.mjs
MOVE_EDITOR=wysiwyg MOVE_CLEAN=1 node scripts/test-file-move-browser.mjs
MOVE_BACKGROUND=1 node scripts/test-file-move-browser.mjs
MOVE_EDITOR=wysiwyg MOVE_BACKGROUND=1 node scripts/test-file-move-browser.mjs
```

脚本输出临时截图和诊断文件所在目录。单元测试另外覆盖两个编辑器的撤销/重做、保存队列、后台标签、HTML/Markdown 地址与异步预览基址配对。

## 当前范围

首期面向 File Browser 的 UTF-8 文本文档，单文件、同磁盘移动。目录拖拽、多选、系统文件拖入和跨磁盘移动不在本期范围。源文件为符号链接时拒绝移动；含 HTML `base` 或动态 MDX 资源属性的文档在预检查时拒绝移动。

其他文档中的入站引用均不会被扫描或自动更新，原来指向旧路径的链接可能因此失效。当前未实现手动全工作区修复入口。链接身份以文档中的路径和 URL 为依据，不扫描资源的所有硬链接或文件系统别名。预览链接保留资源地址；是否支持打开某种文件由系统关联程序决定。

已经执行浏览器生产构建集成验证和本机 Rust 测试；Windows/Linux 及实际 Tauri WebView 的人工拖拽验收仍需在相应环境执行。当前未修改版本号，也未发布。
