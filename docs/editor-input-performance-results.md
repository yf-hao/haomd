# 长文档输入优化：实现与验证

本次已完成源码输入、预览任务调度、Worker 生命周期、大纲、搜索高亮及所见即所得缓存的优化，并补充保存版本与输入法边界保护。

## 实现与 SOLID 对应

- `modules/document/documentSnapshot.ts`：捕获不可变文档模型，按需生成并复用字符串；源码与所见即所得共用该契约。
- `modules/document/taskScheduler.ts`：只负责末次刷新、限频和最大等待；通过时钟接口注入，便于确定性测试。
- `modules/markdown/preview/previewScheduler.ts`：下一帧提交最新输入，后续输入只替换待提交内容，不推迟刷新；通过帧时钟接口注入验证持续刷新。
- `modules/markdown/preview/previewTransport.ts`：Worker 只传输改变的分块，未变化块在主线程复用；版本基准不匹配时回退完整处理。
- `modules/markdown/preview/previewProcessor.ts`：管理单个会话的 Worker、单个执行中任务和最新待处理任务；通过 Worker 端口、缓存、纯处理函数及结果回调注入依赖。
- `hooks/useMarkdownPreview.ts`：只装配浏览器执行器与 React 生命周期；文本变化不销毁执行器。切换文档会使旧会话失效。
- `CodeEditor`：由原生文档维护本地输入；只向需要字符串的兼容调用方提供 onChange。父组件无关刷新不会恢复旧文本。
- 源码大纲将标题扫描移到调度阶段；所见即所得大纲按需运行并缓存不可变子树；搜索选区变化只改变当前匹配装饰。
- 所见即所得序列化缓存按实际缓存文档复用未变块，支持插入/删除；未知或依赖上下文的结构保留完整序列化，输出格式不兼容时也回退。
- 保存结果绑定原文档及实际保存内容；保存期间出现新输入时保留 dirty 状态，切换标签后不会将保存结果应用到新标签。

这些边界分别落实单一职责、开闭、接口隔离和依赖倒置；快照稳定性、Worker/回退结果一致性及不同序列化路径的契约测试验证可替换行为。

## 实时预览修订（当前实现）

用户要求优化不能让预览滞后。第一轮按文档大小等待 80/180 ms 的策略与这一要求不符，已删除：

- 输入后下一帧提交最新快照；同帧输入合并，后续输入不能重置或推迟已排定的帧。
- 预览结果不使用 `startTransition` 降低更新优先级；本地处理在布局阶段提交，Worker 结果到达后直接发布。
- 缓存预览显示时提前准备 Worker 和分块传输基准，首次编辑不再额外等待 Worker 启动。
- 删除每次更新对全部分块重复写入 DOM 属性、重建局部索引的工作；只在内容变化时失效该块的索引，移动块保留局部索引。
- Worker 仅传输变化的分块；基准版本不匹配时使用最新全文回退，避免缺块或显示旧文档。未变化块复用对象，完整渲染内容保持一致。
- 全文预处理复用一次分行结果，没有对应语法时跳过公式转换与 TOC 扫描。

仍遵循 SOLID：帧调度、预览处理、传输编码与解码分别负责单一职责；时钟、Worker 端口和发布回调通过小接口注入。帧调度与后台限频调度分开，后台的等待策略不会影响可见预览。

新增指标使用 MutationObserver 测量每个输入到其文本出现在预览 DOM 的时间。不是屏幕绘制延迟；样本和 Chrome 环境同下文，打开文档并等待 500 ms 后连续输入 30 次。对比本轮修订前的限频实现：

| 字符数 | 预览 DOM 更新 P95（ms，修订前 → 当前） | 当前最大值（ms） | 连续 30 次输入的预览更新次数（前 → 当前） | 当前 dispatch P95（ms） |
| --- | --- | --- | --- | --- |
| 10,000 | 212.3 → 23.2 | 24.6 | 7 → 30 | 5.9 |
| 100,000 | 466.4 → 36.6 | 38.6 | 4 → 30 | 10.3 |
| 500,000 | 750.9 → 187.1 | 224.0 | 5 → 30 | 42.4 |

当前各档均有 30/30 次输入反映到预览，输入期间 Worker 新建次数为 0（大文档在初始化时创建并复用）。预览开启时按帧读取文档，本样本为 30 次；关闭预览时为 0 次。这是保留实时刷新后的实际工作量，不再以降低预览刷新频率压低转换次数。

**限制与未达标项：** 已移除人为等待，但不能宣称任意大小的文档都“零滞后”。50 万字符样本预览 DOM 更新 P95 仍为 187.1 ms；上一轮相同帧策略的测试约 149.7 ms，存在设备负载波动，尚未达到 50 ms 目标。当前 50 万字符同步 dispatch P95 42.4 ms，也高于限频基线 23.5 ms；更频繁地刷新大预览仍会增加主线程负担。后续应继续优化全量预处理和大 DOM 布局，不能重新引入预览防抖来掩盖这一问题。原生 Tauri WebView、首次打开立即输入、真实 IME 和复杂公式/图表的可见延迟尚未验证。

## 第一轮浏览器基准（历史记录，限频策略已撤销）

环境：同一台 macOS 15.5 Intel 设备，系统 Chrome headless，Vite 发布构建，1440×900 视口。使用实际 CodeEditor/MarkdownViewer 组件，四档生成的中文 Markdown 文档；每个场景追加 30 个字符，请求间隔约 40 ms。每个场景独立页面，初始化后再开始计数。

该基准使用原生编辑器 dispatch 衡量同步事务耗时；不等同于键盘事件到屏幕绘制延迟，也不包含完整 WorkspaceShell、Tauri WebView 或原生输入法。此轮前后分别采用原按帧刷新和第一轮限频策略；限频策略现已撤销，以下数字仅保留为历史记录，不能代表当前实时预览实现。完整应用还保留延迟正文同步，因此表中的全文转换次数只适用于该组件基准。

| 字符数 | 预览 | dispatch P95（ms，前 → 后） | 全文转换次数（前 → 后） | Worker 创建次数（前 → 后） |
| --- | --- | --- | --- | --- |
| 10,000 | 关闭 | 6.3 → 6.8 | 30 → 0 | 0 → 0 |
| 10,000 | 开启 | 9.4 → 7.9 | 90 → 8 | 0 → 0 |
| 100,000 | 关闭 | 25.2 → 14.6 | 30 → 0 | 0 → 0 |
| 100,000 | 开启 | 19.8 → 17.6 | 90 → 4 | 30 → 1 |
| 500,000 | 关闭 | 13.9 → 8.4 | 30 → 0 | 0 → 0 |
| 500,000 | 开启 | 33.0 → 22.1 | 86 → 6 | 26 → 1 |
| 1,000,000 | 关闭 | 11.0 → 9.6 | 30 → 0 | 0 → 0 |
| 1,000,000 | 开启 | 25.3 → 11.8 | 81 → 5 | 21 → 1 |

可以稳定确认的收益是：源码事务不再主动生成全文字符串；预览更新合并后全文转换减少；Worker 在输入期间复用。时间指标受布局、语法解析、JIT、GC 和并行系统负载影响，不能据此承诺固定加速倍数。

50 万字符带预览样本的单次最大 dispatch 曾出现约 228 ms 的尖峰，未达到方案中“消除所有长任务”的目标。随后针对该样本开启 Chrome CPU 采样复查，P95 为 12.3 ms、最大值 13.4 ms、全文转换 4 次、Worker 创建 1 次；尖峰未稳定复现。这两次结果一并保留，不能只依据较好的运行作结论。

未测量真实输入到绘制 P95，因此不宣称达到 50 ms 可见反馈指标。后续完整 AST Worker/虚拟化应由真实桌面采样决定；本次保留现有解析/分块语义，修复分块复用时源行号更新遗漏。

## 验证

- 当前完整 Vitest 测试集：136 个文件、700 项测试通过；生产构建（含 TypeScript 检查）通过，新增模块的定向 ESLint 检查通过。
- 新增持续输入不推迟预览、未变块零属性写入、分块移动后的点击定位、折叠恢复后的行高亮测试。
- 新增 Worker 预热、增量传输与完整结果一致、基准版本失配时恢复最新全文的测试。
- 第一轮完整 Vitest 测试集：133 个文件、689 项测试通过；TypeScript 检查和生产构建通过。构建仍有现有的大包与静态/动态导入混用提示。
- 新增输入全文转换计数、过时父值、中文组合输入和切文档隔离测试。
- 新增快照惰性读取、原生组合输入领先于已发布版本、调度合并/最大等待/取消测试。
- 新增 Worker 复用、任务合并、持续输入进展、缓存结果防回退、故障回退、文档会话切换测试。
- 新增块插删/跳过中间版本缓存测试，并使用真实 Milkdown 解析与序列化验证普通正文、代码、列表、表格、链接和空段落。
- 新增搜索索引复用、大纲子树复用，以及保存期间输入和切换标签的回归测试。

浏览器基准原始结果附在本文件末尾。桌面原生输入法和 Tauri WebView 的实际交互仍需在打包应用中验证；本次没有替换已安装的应用。

## 复现

基准脚本将临时构建写入系统临时目录，不修改应用的发布产物。需要本机 Chrome 和 playwright-core；后者可安装到临时目录：

```sh
npm install --prefix /tmp/haomd-perf playwright-core --no-audit --no-fund
cd app
PLAYWRIGHT_MODULE=/tmp/haomd-perf/node_modules/playwright-core/index.mjs node scripts/benchmark-editor-input.mjs /tmp/haomd-perf/result.json
```

Chrome 不在默认 macOS 路径时通过 `CHROME_PATH` 指定。该脚本是组件性能基准，功能回归使用 `bun run test:run`，构建使用 `bun run build`。

可设置 `BENCHMARK_SIZES=500000 BENCHMARK_PROFILE=1` 单独采样大文档；脚本会输出 Chrome CPU profile 的临时文件路径。

## 当前实时预览原始结果

```json
{
  "before": [
    {
      "size": 10000,
      "preview": false,
      "samples": 30,
      "dispatchP95Ms": 6.699999988079071,
      "dispatchMaxMs": 7.899999976158142,
      "fullReads": 0,
      "workerStarts": 0,
      "previewCommitP95Ms": null,
      "previewCommitMaxMs": null,
      "reflectedInputs": 0,
      "previewUpdates": 0
    },
    {
      "size": 10000,
      "preview": true,
      "samples": 30,
      "dispatchP95Ms": 7.0999999940395355,
      "dispatchMaxMs": 8.800000011920929,
      "fullReads": 7,
      "workerStarts": 0,
      "previewCommitP95Ms": 212.2999999821186,
      "previewCommitMaxMs": 217,
      "reflectedInputs": 30,
      "previewUpdates": 7
    },
    {
      "size": 100000,
      "preview": false,
      "samples": 30,
      "dispatchP95Ms": 8.900000005960464,
      "dispatchMaxMs": 10.599999994039536,
      "fullReads": 0,
      "workerStarts": 0,
      "previewCommitP95Ms": null,
      "previewCommitMaxMs": null,
      "reflectedInputs": 0,
      "previewUpdates": 0
    },
    {
      "size": 100000,
      "preview": true,
      "samples": 30,
      "dispatchP95Ms": 8.5,
      "dispatchMaxMs": 11.800000011920929,
      "fullReads": 4,
      "workerStarts": 1,
      "previewCommitP95Ms": 466.40000000596046,
      "previewCommitMaxMs": 478.30000001192093,
      "reflectedInputs": 30,
      "previewUpdates": 4
    },
    {
      "size": 500000,
      "preview": false,
      "samples": 30,
      "dispatchP95Ms": 7.5,
      "dispatchMaxMs": 14.300000011920929,
      "fullReads": 0,
      "workerStarts": 0,
      "previewCommitP95Ms": null,
      "previewCommitMaxMs": null,
      "reflectedInputs": 0,
      "previewUpdates": 0
    },
    {
      "size": 500000,
      "preview": true,
      "samples": 30,
      "dispatchP95Ms": 23.5,
      "dispatchMaxMs": 57.19999998807907,
      "fullReads": 5,
      "workerStarts": 1,
      "previewCommitP95Ms": 750.9000000059605,
      "previewCommitMaxMs": 811,
      "reflectedInputs": 30,
      "previewUpdates": 5
    }
  ],
  "after": [
    {
      "size": 10000,
      "preview": false,
      "samples": 30,
      "dispatchP95Ms": 6.299999982118607,
      "dispatchMaxMs": 8.400000005960464,
      "fullReads": 0,
      "workerStarts": 0,
      "previewCommitP95Ms": null,
      "previewCommitMaxMs": null,
      "reflectedInputs": 0,
      "previewUpdates": 0
    },
    {
      "size": 10000,
      "preview": true,
      "samples": 30,
      "dispatchP95Ms": 5.9000000059604645,
      "dispatchMaxMs": 9.5,
      "fullReads": 30,
      "workerStarts": 0,
      "previewCommitP95Ms": 23.200000017881393,
      "previewCommitMaxMs": 24.599999994039536,
      "reflectedInputs": 30,
      "previewUpdates": 30
    },
    {
      "size": 100000,
      "preview": false,
      "samples": 30,
      "dispatchP95Ms": 13,
      "dispatchMaxMs": 15.600000023841858,
      "fullReads": 0,
      "workerStarts": 0,
      "previewCommitP95Ms": null,
      "previewCommitMaxMs": null,
      "reflectedInputs": 0,
      "previewUpdates": 0
    },
    {
      "size": 100000,
      "preview": true,
      "samples": 30,
      "dispatchP95Ms": 10.300000011920929,
      "dispatchMaxMs": 12.600000023841858,
      "fullReads": 30,
      "workerStarts": 0,
      "previewCommitP95Ms": 36.599999994039536,
      "previewCommitMaxMs": 38.60000002384186,
      "reflectedInputs": 30,
      "previewUpdates": 30
    },
    {
      "size": 500000,
      "preview": false,
      "samples": 30,
      "dispatchP95Ms": 7.700000017881393,
      "dispatchMaxMs": 11.099999994039536,
      "fullReads": 0,
      "workerStarts": 0,
      "previewCommitP95Ms": null,
      "previewCommitMaxMs": null,
      "reflectedInputs": 0,
      "previewUpdates": 0
    },
    {
      "size": 500000,
      "preview": true,
      "samples": 30,
      "dispatchP95Ms": 42.400000005960464,
      "dispatchMaxMs": 44.79999998211861,
      "fullReads": 30,
      "workerStarts": 0,
      "previewCommitP95Ms": 187.10000002384186,
      "previewCommitMaxMs": 224,
      "reflectedInputs": 30,
      "previewUpdates": 30
    }
  ]
}
```

## 第一轮原始结果

```json
{
  "before": [
    {
      "size": 10000,
      "preview": false,
      "samples": 30,
      "dispatchP95Ms": 6.299999982118607,
      "dispatchMaxMs": 8.199999988079071,
      "fullReads": 30,
      "workerStarts": 0
    },
    {
      "size": 10000,
      "preview": true,
      "samples": 30,
      "dispatchP95Ms": 9.400000005960464,
      "dispatchMaxMs": 9.400000005960464,
      "fullReads": 90,
      "workerStarts": 0
    },
    {
      "size": 100000,
      "preview": false,
      "samples": 30,
      "dispatchP95Ms": 25.200000017881393,
      "dispatchMaxMs": 33.29999998211861,
      "fullReads": 30,
      "workerStarts": 0
    },
    {
      "size": 100000,
      "preview": true,
      "samples": 30,
      "dispatchP95Ms": 19.80000001192093,
      "dispatchMaxMs": 21.30000001192093,
      "fullReads": 90,
      "workerStarts": 30
    },
    {
      "size": 500000,
      "preview": false,
      "samples": 30,
      "dispatchP95Ms": 13.899999976158142,
      "dispatchMaxMs": 20.19999998807907,
      "fullReads": 30,
      "workerStarts": 0
    },
    {
      "size": 500000,
      "preview": true,
      "samples": 30,
      "dispatchP95Ms": 33,
      "dispatchMaxMs": 183.90000000596046,
      "fullReads": 86,
      "workerStarts": 26
    },
    {
      "size": 1000000,
      "preview": false,
      "samples": 30,
      "dispatchP95Ms": 11,
      "dispatchMaxMs": 11.800000011920929,
      "fullReads": 30,
      "workerStarts": 0
    },
    {
      "size": 1000000,
      "preview": true,
      "samples": 30,
      "dispatchP95Ms": 25.30000001192093,
      "dispatchMaxMs": 26.400000005960464,
      "fullReads": 81,
      "workerStarts": 21
    }
  ],
  "after": [
    {
      "size": 10000,
      "preview": false,
      "samples": 30,
      "dispatchP95Ms": 6.800000011920929,
      "dispatchMaxMs": 8.599999994039536,
      "fullReads": 0,
      "workerStarts": 0
    },
    {
      "size": 10000,
      "preview": true,
      "samples": 30,
      "dispatchP95Ms": 7.9000000059604645,
      "dispatchMaxMs": 10,
      "fullReads": 8,
      "workerStarts": 0
    },
    {
      "size": 100000,
      "preview": false,
      "samples": 30,
      "dispatchP95Ms": 14.599999994039536,
      "dispatchMaxMs": 25.700000017881393,
      "fullReads": 0,
      "workerStarts": 0
    },
    {
      "size": 100000,
      "preview": true,
      "samples": 30,
      "dispatchP95Ms": 17.599999994039536,
      "dispatchMaxMs": 27.700000017881393,
      "fullReads": 4,
      "workerStarts": 1
    },
    {
      "size": 500000,
      "preview": false,
      "samples": 30,
      "dispatchP95Ms": 8.400000005960464,
      "dispatchMaxMs": 10.900000005960464,
      "fullReads": 0,
      "workerStarts": 0
    },
    {
      "size": 500000,
      "preview": true,
      "samples": 30,
      "dispatchP95Ms": 22.099999994039536,
      "dispatchMaxMs": 227.89999997615814,
      "fullReads": 6,
      "workerStarts": 1
    },
    {
      "size": 1000000,
      "preview": false,
      "samples": 30,
      "dispatchP95Ms": 9.599999994039536,
      "dispatchMaxMs": 12.900000005960464,
      "fullReads": 0,
      "workerStarts": 0
    },
    {
      "size": 1000000,
      "preview": true,
      "samples": 30,
      "dispatchP95Ms": 11.799999982118607,
      "dispatchMaxMs": 60.900000005960464,
      "fullReads": 5,
      "workerStarts": 1
    }
  ]
}
```
