## MindElixir 在 Tauri 导出 PDF 丢图问题分析与改造方案

### 一、问题现象

- 在 HaoMD 内使用「导出 PDF」时：
  - 预览窗口中可以清楚看到 MindElixir 导出的思维导图 PNG；
  - 实际保存出的 PDF 文件中，有时整张 Mind 图完全消失，尤其是 Mind 图位于文档靠下位置或节点较多时。
- 将同一篇文档先导出 HTML，再用 Safari 打开该 HTML 并打印为 PDF：
  - PDF 中 Mind 图片始终正常显示。

结论：**HTML 与 PNG 本身没有问题，问题只发生在 Tauri WebView + Portal 打印方案这一链路上。**

---

### 二、现有实现简要回顾

#### 1. HTML / PDF 共用内容生成逻辑

- 函数：`prepareExportHtmlContents(ctx)`（`app/src/modules/export/html/index.tsx`）
- 主要流程：
  1. 解析 Markdown，预处理 ```mind``` 代码块，通过 MindElixir 渲染为内嵌 SVG；
  2. 使用 React `renderToString(<ExportWrapper ... />)` 生成 HTML 片段；
  3. 在 `rasterizeMindSvgs` 中，将 `.mind-diagram-export` 内的 Mind SVG：
     - 基于 `getBBox()` 计算内容边界，隐藏背景 `rect` 后裁剪 `viewBox`，减少四周留白；
     - 创建 `canvas`，按一定像素密度绘制 SVG；
     - 生成 PNG data URL，并用 `<img>` 替换原 SVG；
  4. 调用 `convertImagesToBase64` 将所有图片转为 Base64 内嵌；
  5. 通过 `generateHTMLTemplate` 包装为完整 HTML 文档（包含样式 / Mermaid 脚本等）。

> **因此：HTML 导出与 PDF 导出共享同一份最终 HTML，Mind 图在这一步已经是 `<img src="data:image/png;base64,...">`。**

#### 2. Tauri 内的 PDF 导出逻辑

- 文件：`app/src/modules/export/pdf/index.ts`
- 核心函数：`exportToPdf(ctx)` → `printViaMainPortal(fullHtml, title)`。
- `printViaMainPortal` 的主要逻辑：
  1. 调用 `cleanupOld()` 删除上一次导出留下的 `#haomd-print-portal`、`#haomd-print-override`、`#haomd-print-assets`；
  2. 使用 `DOMParser` 解析传入的 `fullHtml`，取出 `bodyContent` 和 `head` 中的样式/脚本；
  3. 在当前 WebView 的 `document.body` 中创建一个离屏容器：
     - `portal.id = 'haomd-print-portal'`，内容为 `<div class="markdown-body">${bodyContent}</div>`；
     - 在 `document.head` 中注入从 HTML 模板解析出来的样式；
     - 注入一段 `style#haomd-print-override`，其中：
       - 屏幕状态下：
         - `#haomd-print-portal { position: fixed; left: -9999px; top: 0; width: 1000px; visibility: visible; }`
       - `@media print` 状态下：
         - `#haomd-print-portal { position: absolute; left: 0; top: 0; width: 100%; height: auto; }`
         - 隐藏原应用界面：`body visibility:hidden; #root / #app / .workspace-shell display:none`；
  4. 动态注入模板 HTML 中的脚本，并等待加载（Mermaid 等）；
  5. 调用 `window.print()` 打开系统打印对话框。

- 清理策略（已改造）：
  - 开头调用 `cleanupOld()` 清理旧的 Portal 和样式；
  - 在 `window.onafterprint` 中，只清理动态注入脚本并恢复 `document.title`，不再删除 Portal DOM；
  - 真正的 Portal DOM 删除交由下一次调用 `printViaMainPortal` 时的 `cleanupOld()` 处理。

---

### 三、Safari 正常而 Tauri 丢图的原因分析

#### 1. Safari 路径

- Safari 直接打开导出的 HTML 文件；
- Mind PNG 是普通文档流中的 `<img>`，没有离屏 Portal、没有负坐标；
- Safari 调用 `window.print()` 时，WebKit 按标准规则：
  - 应用 `@media print` 样式；
  - 基于当前 DOM 布局完整渲染所有页面；
  - 最终生成 PDF，Mind 图被正常包含其中。

#### 2. Tauri 路径

在 Tauri 的 WebView 中，我们 **不是** 打印当前页面的真实 DOM，而是：

1. 在现有应用 DOM 之上再动态插入一个 `#haomd-print-portal`，并在屏幕态下把它放在屏幕外：

   ```css
   #haomd-print-portal {
     position: fixed;
     left: -9999px;
     top: 0;
     display: block;
     visibility: visible;
     width: 1000px;
     background: white;
   }
   ```

2. 依赖 `@media print` 将这个 Portal 在打印时“拉回到页面原点”：

   ```css
   @media print {
     body { visibility: hidden; margin: 0; }
     #haomd-print-portal {
       visibility: visible;
       display: block;
       position: absolute;
       left: 0;
       top: 0;
       width: 100%;
       height: auto;
       z-index: 2147483647;
     }
     #root, #app, .workspace-shell { display: none; }
   }
   ```

3. 对 WebKit/Tauri 来说，这套方案有两个不确定点：

   - **离屏 + 负坐标**：
     - 预览阶段，WebView 在内部应用了 `@media print`，Portal 被临时搬回 `(0, 0)`，你能在打印预览中看到 Mind 图；
     - 但在真正交给系统生成 PDF 的阶段，某些版本的 WebKit/WebView 接入实现可能仍然基于“屏幕布局”或简化后的布局树，对 "fixed 且起始于屏幕外" 的元素支持不完整，导致 Portal 内容没有被包含在最终 PDF 中；

   - **Portal 与主文档的混合布局**：
     - 我们在同一个 WebView DOM 上同时存在应用界面和打印 Portal；
     - 为了隐藏原界面，`body` 在 `@media print` 下被设为 `visibility:hidden`，仅依赖 `#haomd-print-portal` 的 `visibility:visible` 抢回来可见性；
     - 在某些实现中，`visibility:hidden` 可能对整个文档树生效，而 Portal 的覆盖逻辑在最终 PDF 合成时没有完全生效，从而使得 Portal 内的内容被过滤掉。

综合你的反馈：

- Safari 打印 **正常**，说明 HTML/PNG、自身尺寸、`@media print` 样式等都没有根本问题；
- Tauri WebView 预览 **正常**，说明 Portal 内容在浏览器内部布局时是可以被正确渲染的；
- 但最终 PDF 中消失，说明问题出现在 **WebView → 系统打印 / PDF 合成** 这一段，且与当前的「离屏 Portal + 负坐标 + visibility 覆盖」方案强相关。

> 结论：**这是 Tauri WebView + 当前 Portal 方案在打印管线中的兼容性问题，而非内容或图片本身的问题。**

---

### 四、改造方案设计

#### 目标

1. 保持现有 `prepareExportHtmlContents` 和 HTML 导出行为不变；
2. 尽量让 Tauri 内的打印链路更接近 Safari 的「直接打印 HTML 页」的行为；
3. 避免使用 `left:-9999px` 这类负坐标离屏策略，减少 WebView/打印管线的兼容性风险；
4. 确保 Mind PNG 无论位于文档中部还是底部、节点多少，都能在最终 PDF 中稳定出现。

#### 方案 A：不再使用负坐标离屏 Portal

**思路**：仍然保留 Portal 渲染（便于与应用界面区分），但改为：

- 屏幕状态：`#haomd-print-portal` 用 `display:none` 隐藏，而不是 `left:-9999px`；
- 打印状态：通过 `@media print` 将 Portal 设为 `display:block`、`position:static/relative`，让浏览器把它当成普通文档的一部分来布局和渲染；
- 同时隐藏原应用根节点，避免应用 UI 出现在 PDF 中。

**关键调整点**：

1. 修改 `printViaMainPortal` 中注入的样式：

   - 屏幕态：

     ```css
     #haomd-print-portal {
       display: none !important;
     }
     ```

   - 打印态：

     ```css
     @media print {
       body {
         background: white !important;
         margin: 0 !important;
       }
       #haomd-print-portal {
         display: block !important;
         position: static !important;  /* 或 relative，相当于正常文档流 */
         width: 100% !important;
         background: white !important;
         color: #1a1a1a !important;
       }
       /* 可以选择性隐藏原应用根节点 */
       #root, #app, .workspace-shell {
         display: none !important;
       }
     }
     ```

   - 去掉 `left:-9999px` 和 `position:fixed`，避免 Portal 被当作“屏幕外元素”而不参与 PDF 合成。

2. 维持 `cleanupOld()` + `onafterprint` 的改造版本：

   - 每次打印前在函数开头调用 `cleanupOld()` 清理旧 Portal 和样式；
   - `onafterprint` 中只清理脚本与恢复标题，不再强删 DOM，由下次打印的 `cleanupOld()` 负责；

**预期效果**：

- 打印管线看到的是一个“普通页面流里的 `<div id="haomd-print-portal">...`”，内部结构与 Safari 打开放在 `<body>` 中的 HTML 非常接近；
- Mind PNG 被当作标准 `<img>` 处理，减少因为元素定位/可见性 hack 带来的丢失风险。

#### 方案 B（备用）：单独使用打印 WebView / 新窗口

如果方案 A 实践后仍有兼容性问题，可以采用更接近浏览器行为的方案：

1. 在 Tauri 主 WebView 内，不再直接用 Portal，而是：
   - 通过 IPC 调用，在主窗口中打开一个隐藏或子 WebView / 新窗口；
   - 在该 WebView 中直接加载 `fullHtml` 内容（类似 Safari 直接打开 HTML）；

2. 在这个“打印专用 WebView”中：
   - 不再需要 Portal，直接用模板里的 `<body><div class="markdown-body">...</div></body>`；
   - 注入最小必要的 CSS（如隐藏滚动条、设置页宽等）；
   - 调用 `window.print()`，然后在 `onafterprint` 中关闭该 WebView。

**优点**：

- 打印路径几乎等价于 Safari：一次打印对应一个纯内容页面，WebKit 行为最接近标准浏览器；
- 与应用 UI 完全解耦，不需要在一个 DOM 上混合管理应用界面与打印 Portal。

**缺点**：

- 需要在 Tauri 层面管理额外 WebView / 窗口，工程改造稍大；
- 需要在 Rust / Command 侧增加对应 API（比如打开/关闭打印视图）。

---

### 五、后续验证思路

无论采用方案 A 还是方案 B，建议按以下步骤验证：

1. 准备一篇带有：
   - 多段文本；
   - 一个 mermaid 图；
   - 一个节点较多、位于文档靠下的 MindElixir 图；

2. 在 HaoMD 内：
   - 观察预览窗口中的打印效果（应该正常显示所有内容）；
   - 保存为 PDF，检查：
     - Mind PNG 是否出现在最终 PDF 中；
     - 是否有被分页切断或缩放异常的情况；

3. 用 Safari 对同一 HTML 做对照打印：
   - 确认布局与 Tauri 内打印结果尽量一致；
   - 如果 Safari 一直正常，而 Tauri 在采用方案 A 后仍有丢图，优先考虑向方案 B 过渡。

---

### 六、小结

- **问题根因**：不是 MindElixir、本身 PNG 尺寸或 HTML 模板问题，而是当前 Tauri 中采用的「离屏 Portal + 负坐标 + visibility 覆盖」打印方案，在 WebView → 系统 PDF 合成阶段存在兼容性问题，导致 Portal 内的 Mind PNG 偶尔不被写入最终 PDF。
- **建议优先方案**：
  - 继续使用 Portal，但改为屏幕态 `display:none`、打印态 `display:block + position:static/relative`，去掉 `left:-9999px` 等离屏 hack；
  - 保持已改造的 cleanup 策略（打印期间不再强删 Portal DOM）。
- **备用方案**：
  - 引入专门的打印 WebView/窗口，直接加载完整 HTML、走标准 `window.print()` 打印路径，从根本上对齐 Safari 的行为。
