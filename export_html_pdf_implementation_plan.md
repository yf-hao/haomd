# 导出为 HTML 与 PDF 功能实现方案

本文档详细记录了如何在现有的 Tauri 项目架构下，于 `File` 原生菜单下新增 `Export -> HTML` 和 `Export -> PDF` 功能，并打通其与前端事件命令总线（Command Registry）的交互逻辑。

## 架构概览

当前项目的应用逻辑采用了经典的 **发布-订阅 (Pub-Sub)** 隔离模型：
1. **Tauri 后端原生菜单**：触发包含特殊前缀的指令。
2. **主进程事件总线 (Event Bus)**：将菜单操作传递给前端。
3. **前端接收器 (`useCommandSystem`)**：对动作 ID 进行分发。
4. **统一命令池 (`commands/registry.ts`)**：执行最终闭包。

通过分析，前端代码库目前已经预先在 `src/modules/export/html/index.tsx` 中编写了相关的逻辑骨架 `exportToHtml(ctx)`。接下来的重点在于将骨架关联，并补充 PDF 部分的解析。

---

## 实施步骤详解

### 步骤一：在 Tauri 后端添加系统级的导出子菜单
**目标修改文件**：`src-tauri/src/lib.rs`

我们需要扩充操作系统的原生应用菜单，赋予用户触发导出的入口。

1. **新建子菜单实例：**
   使用 Tauri 提供的 `SubmenuBuilder` 构建一个名为 "Export" 的子节点，下挂 "HTML" 和 "PDF" 项。
   ```rust
   let export_menu = SubmenuBuilder::new(app, "Export")
       .item(&MenuItemBuilder::new("HTML").id("export_html").build(app)?)
       .item(&MenuItemBuilder::new("PDF").id("export_pdf").build(app)?)
       .build()?;
   ```

2. **嵌套到原有的 File 菜单链中：**
   在原有的 `let file_menu = SubmenuBuilder::new(app, "File")` 中，寻找合适的位置（例如 "Save As" 之后）通过 `.item(&export_menu)` 追加到文件菜单系统里去。注意该菜单被选中时抛出的 action ID（`export_html`、`export_pdf`）最终会由 `on_menu_event` 进行路由分发。

---

### 步骤二：扩展前端的命令系统层（Command Registry）
**目标修改文件**：`src/modules/commands/registry.ts`

捕获到全局事件之后，前端的 `useCommandSystem` 会调用被注入的命令字典来寻找对应逻辑。

1. **注册指令环境所需的 Context：**
   在 `FileCommandContext` 类型声明（或根据职能划分为 `ExportCommandContext` 并进行接口并集拓展）中补充相应的声明回调：
   ```typescript
   exportHtml?: () => Promise<void>
   exportPdf?: () => Promise<void>
   ```

2. **在注册表工厂方法中添加处理器：**
   如 `createFileCommands` 或单独构建一个 `createExportCommands(ctx)` 来接管具体的分发：
   ```typescript
   export_html: async () => {
     if (ctx.exportHtml) {
       await ctx.exportHtml();
     } else {
       ctx.setStatusMessage('当前版本 HTML 导出功能未挂载');
     }
   },
   export_pdf: async () => {
     if (ctx.exportPdf) {
       await ctx.exportPdf();
     } else {
       ctx.setStatusMessage('当前版本 PDF 导出功能未挂载');
     }
   },
   ```

---

### 步骤三：编写和整合核心的导出业务逻辑
**目录/目标文件**：`src/modules/export/` 及其子目录。

因为 `src/modules/export/html/index.tsx` 已包含 `exportToHtml` 且实现了 Mind / Mermaid 等特殊富文本转换的能力，我们要保证其参数输入与第二步 Context 结构对齐。随后为 PDF 提供补充：

**PDF导出的模块化实现（建议策略）：**
为了保证所见即所得，复用 `ExportWrapper` 处理并生成的最终 HTML 结果将其无头打印。

1. 新建 `src/modules/export/pdf/index.ts`（或者 `index.tsx`）。
2. 在这个方法内部：
   - 第一阶段获取当前 Markdown 后，同 HTML 一样渲染和替换掉所有的流程图组件。
   - 方案一：利用原生的 `window.print()`。你可以创建一个内嵌 `iframe`，将前面步骤生成的 HTML 作为其源，调用其内部的原生打印指令；（优点：自带系统级 PDF 导出对话框，体积零增加）
   - 方案二：集成譬如 `html2pdf.js` 这类库。传入 HTML 节点直接进行 PDF 下载保存。（优点：可完全控制页眉/页脚等生成风格）

---

### 步骤四：在顶级组件中进行服务装配
**目标修改文件**：`src/App.tsx` 或类似注入所有提供者（Provider/Commands）的核心文件（视具体项目的上下文注射处而定）

将所有的脉络统一对接连接，将底层的能力赋予给 `useCommandSystem` 供注册表调配。

```typescript
import { exportToHtml } from './modules/export/html';
import { exportToPdf } from './modules/export/pdf'; // 根据步骤三创建的库

// 在调用 useCommandSystem 的闭包前封装并绑定好参数提供者
const handleExportHtml = async () => {
  // exportToHtml 预期得到形如 { setStatusMessage, getCurrentMarkdown, ... } 这样的执行上下文
  await exportToHtml({
    setStatusMessage,
    getCurrentMarkdown,
    getCurrentFileName,
    getFilePath, // 假设存在的向其提供工作区路径的钩子以便挂载基准图片链接
  });
};

const handleExportPdf = async () => {
  await exportToPdf({ /* 同上的上下文映射 */ });
};

// 注入执行器
useCommandSystem({
  ...原有参数,
  exportHtml: handleExportHtml,
  exportPdf: handleExportPdf,
});
```

### 总结
遵循该方案，系统可以平滑接驳原有的 Tauri 事件设计理念。无论是后面引入快捷键绑定，还是进行批量的导出调用扩展，都能得到很好的解耦。
