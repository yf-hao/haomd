### Sidebar 功能实现步骤

> 目标：在左侧展示可展开/折叠的文件树，支持 Open Folder / 打开文件时同步到 Sidebar，并持久化 Sidebar 状态（根目录 + 展开目录），下次启动自动恢复。

---

### 一、后端（Rust / Tauri）层：文件与 Sidebar 状态服务

1. **在 `lib.rs` 中为 Sidebar 状态新增类型和路径函数**（参考 `recent_store_path`）：
   - 新增 `sidebar_state_path(app: &AppHandle) -> std::io::Result<PathBuf>`，路径放在 `config_dir/haomd/sidebar_state.json`。
   - 定义 `SidebarState` 结构体：
     - `root: Option<String>`
     - `expanded_paths: Vec<String>`。

2. **实现读写 Sidebar 状态的函数**：
   - `async fn read_sidebar_state(app: &AppHandle) -> std::io::Result<SidebarState>`：
     - 如果文件不存在，返回默认值 `SidebarState { root: None, expanded_paths: vec![] }`；
     - 否则读取 JSON 并反序列化。
   - `async fn write_sidebar_state(app: &AppHandle, state: &SidebarState) -> std::io::Result<()>`：
     - 将结构体序列化为 JSON 并写入 `sidebar_state.json`。

3. **新增 Tauri 命令：`load_sidebar_state` 与 `save_sidebar_state`**：
   - `#[tauri::command] async fn load_sidebar_state(app: AppHandle, trace_id: Option<String>) -> ResultPayload<SidebarState>`：
     - 调用 `read_sidebar_state`，错误时返回 `ErrorCode::IoError`；
     - 成功时返回 `SidebarState`。
   - `#[tauri::command] async fn save_sidebar_state(app: AppHandle, state: SidebarState, trace_id: Option<String>) -> ResultPayload<()>`：
     - 调用 `write_sidebar_state`，错误时返回 `ErrorCode::IoError`，成功时返回 OK。
   - 在 `invoke_handler` 宏中注册这两个命令。

4. **为目录树新增文件枚举命令 `list_folder`**：
   - 定义 `FsEntry` 结构体：`path: String`, `name: String`, `kind: "file" | "dir"`。
   - `#[tauri::command] async fn list_folder(app: AppHandle, path: String, trace_id: Option<String>) -> ResultPayload<Vec<FsEntry>>`：
     - 归一化路径（可复用 `normalize_path`）。
     - 使用 `tokio::fs::read_dir` 递归遍历目录：
       - 仅保留扩展名在 `md / markdown / mdx / txt` 的文件；
       - 子目录一律保留。
     - 返回扁平列表或分层结构，前端根据实际需要决定。

---

### 二、前端 modules 层：对 Tauri 的封装

5. **在 `app/src/modules/files` 下增加/扩展 `fsService`**：
   - 新增类型：
     ```ts
     export type FileKind = 'file' | 'dir'

     export type FileEntry = {
       path: string
       name: string
       kind: FileKind
     }
     ```
   - 导出 `listFolder(path: string): Promise<FileEntry[]>`：
     - 使用 `invoke('list_folder', { path })` 调用后端；
     - 捕获错误并转换为统一的 `Result` 或抛出异常，由调用方处理。

6. **在 `app/src/modules/sidebar` 下新增 `sidebarStateRepo.ts`**：
   - 定义前端版本的 `SidebarState`：
     ```ts
     export type SidebarState = {
       root: string | null
       expandedPaths: string[]
     }
     ```
   - 实现：
     - `loadSidebarState(): Promise<SidebarState>`：调用 `invoke('load_sidebar_state')`，将 `Option<String>` 转为 `string | null`；错误时返回默认值。
     - `saveSidebarState(state: SidebarState): Promise<void>`：调用 `invoke('save_sidebar_state', { state })`，错误时仅在控制台警告。

---

### 三、前端 domain 层：Sidebar 文件树纯逻辑

7. **在 `app/src/domain/sidebarTree.ts`（或类似路径）中定义纯类型与函数**：
   - 类型定义：
     ```ts
     export type FileTreeNode = {
       id: string
       name: string
       path: string
       kind: 'file' | 'dir'
       children?: FileTreeNode[]
     }
     ```
   - 纯函数：
     - `buildFileTree(root: string, entries: FileEntry[]): FileTreeNode[]`
       - 将扁平 `FileEntry[]` 构造成按目录分层的树结构；
       - 使用 `path` 作为 `id`，`name` 为文件名 / 目录名。
     - `toggleExpanded(prev: Record<string, boolean>, path: string): Record<string, boolean>`
       - 翻转某个目录的展开状态。
     - `expandedMapFromPaths(paths: string[]): Record<string, boolean>` 与 `expandedPathsFromMap(map)`
       - 在数组与 map 之间转换，方便持久化。
     - （可选）`computeParentsToExpand(root: string, filePath: string): string[]`
       - 计算要让某个文件可见，需要展开的所有父目录路径。

> 这一层只包含函数和类型，不依赖 React、Tauri，方便单元测试。

---

### 四、前端 hooks 层：`useSidebar` 管理 Sidebar 状态

8. **在 `app/src/hooks/useSidebar.ts` 中创建 `useSidebar`**：

   - 内部 state：
     ```ts
     const [root, setRoot] = useState<string | null>(null)
     const [tree, setTree] = useState<FileTreeNode[] | null>(null)
     const [expanded, setExpanded] = useState<Record<string, boolean>>({})
     ```

   - **初始化加载持久化状态**：
     - `useEffect` 中调用 `sidebarStateRepo.loadSidebarState()`：
       - 如果 `state.root` 存在：
         - `setRoot(state.root)`；
         - `setExpanded(expandedMapFromPaths(state.expandedPaths))`；
         - 调用 `fsService.listFolder(state.root)` 获取 `FileEntry[]`，再经 `buildFileTree` 设置 `tree`。

   - **状态变更时保存 Sidebar 状态**：
     - 另一个 `useEffect` 监听 `[root, expanded]`：
       - 若 `root` 为 `null`，可直接返回；
       - 调 `sidebarStateRepo.saveSidebarState({ root, expandedPaths: expandedPathsFromMap(expanded) })`。

   - **操作方法**：
     - `toggleNode(path: string)`：调用 `setExpanded(prev => toggleExpanded(prev, path))`。
     - `openFolderAsRoot(path: string)`：
       - `const entries = await fsService.listFolder(path)`；
       - `setRoot(path)`，`setTree(buildFileTree(path, entries))`；
       - `setExpanded({ [path]: true })`。
     - `ensureFileVisible(path: string)`：
       - 若 `root` 为 `null`：
         - 取文件父目录 `dir = dirname(path)`；
         - `openFolderAsRoot(dir)`，并将对应父链全部标记为展开。
       - 若 `root` 不为 `null` 且 `path` 在 `root` 子树下：
         - 使用 `computeParentsToExpand(root, path)` 计算需要展开的目录路径，合并到 `expanded` map 中。

   - hook 对外返回：
     ```ts
     return {
       root,
       tree,
       expanded,
       toggleNode,
       openFolderAsRoot,
       ensureFileVisible,
     }
     ```

---

### 五、Sidebar UI 组件层：`Sidebar` + `TreeNode`

9. **在 `app/src/components/Sidebar.tsx` 中实现展示组件**：

   - 接收 props：
     ```ts
     type SidebarProps = {
       tree: FileTreeNode[] | null
       expanded: Record<string, boolean>
       onToggle: (path: string) => void
       onFileClick: (path: string) => void
       activePath?: string | null
     }
     ```

   - 使用递归组件 `TreeNode` 渲染树：
     - 目录节点：显示展开/折叠图标，`onClick` 调 `onToggle(node.path)`；
     - 文件节点：点击时调用 `onFileClick(node.path)`；
     - 根据 `level` 做缩进，根据 `activePath === node.path` 高亮当前文件。

10. **在 CSS (`App.css` 或新文件) 中为 `.sidebar`, `.tree-row`, `.dir`, `.file`, `.active` 等类名添加样式**：
    - Sidebar 固定宽度（如 240–280px），右侧编辑区 `flex: 1`；
    - 使用 `display: flex` 在 `App` 外层布局中并排展示 Sidebar 与 workspace。

---

### 六、在 `App.tsx` 中组合：统一“打开文件”流程

11. **在 `App` 顶部使用 `useSidebar`**：

   ```ts
   const sidebar = useSidebar()
   ```

12. **定义统一的“在新标签中打开文件”的函数 `openFileInNewTab`**：

   - 基于现有的 `openFromPath` 和 `createTab`：
     ```ts
     const openFileInNewTab = useCallback(
       async (path: string) => {
         const resp = await openFromPath(path)
         if (!resp.ok) return resp

         const { path: realPath, content } = resp.data

         // 1. 标签逻辑
         createTab({ path: realPath, content })

         // 2. 同步编辑器
         setMarkdown(content)
         setPreviewValue(content)
         setActiveLine(1)

         // 3. Sidebar 同步
         await sidebar.ensureFileVisible(realPath)

         return resp
       },
       [openFromPath, createTab, setMarkdown, setPreviewValue, setActiveLine, sidebar],
     )
     ```

13. **将 Open Recent、Sidebar 点击、Open File 都改为调用 `openFileInNewTab`**：

   - Tauri `onOpenRecentFile` 监听：
     - 把原本 `createTab + handleOpenPath` 的逻辑改成：
       ```ts
       useEffect(() => {
         const unlisten = onOpenRecentFile(async (path) => {
           await openFileInNewTab(path)
         })
         return () => unlisten()
       }, [openFileInNewTab])
       ```

   - `registry.ts` 的 `open_file` 命令：
     - `ctx.openFile()` 返回路径+内容后，转而调用 App 中暴露的能力 `openFileInNewTab(path)`，而不是直接操作 tab 内容。

   - `Sidebar` 的 `onFileClick`：
     - 在 `App` 中传入 `onFileClick={openFileInNewTab}`。

14. **在 `App` 布局中加入 Sidebar**：

   - 外层新增一个水平 layout 容器：
     ```tsx
     <div className="app-shell">
       <TabBar ... />
       <div className="layout-row">
         {sidebar.tree && (
           <Sidebar
             tree={sidebar.tree}
             expanded={sidebar.expanded}
             onToggle={sidebar.toggleNode}
             onFileClick={openFileInNewTab}
             activePath={activeTab?.path ?? null}
           />
         )}

         {/* 原有 main.workspace 保持不变 */}
         <main className={...} ...>
           {/* Editor + Preview */}
         </main>
       </div>

       {conflictError && <ConflictModal ... />}
     </div>
     ```

   - 在 CSS 中为 `.layout-row` 设置 `display: flex;`，Sidebar 设置固定宽度，workspace 使用 `flex: 1`。

---

### 七、命令系统集成（可选增强）

15. **在命令上下文中增加 Sidebar 能力而非细节**：

   - 在 `CommandContext` 里新增：
     - `openFolderInSidebar: () => Promise<void>`：内部调用 `openFolderAsRoot`；
     - `toggleSidebarVisible: () => void`（若你有 View → Toggle Sidebar 菜单）。

   - 在 `createCommandRegistry` 中：
     - `open_folder` 改为使用 `openFolderInSidebar`：
       - 使用 Tauri 对话框选择目录；
       - 成功后调用 `openFolderAsRoot(chosenPath)`；
       - 设置状态消息。

> 这样命令系统只知道“打开文件夹到 Sidebar”，而不关心 Sidebar 如何存储状态、如何持久化，降低耦合。

---

以上步骤按照模块顺序执行即可：先实现后端命令与前端 `fsService/sidebarStateRepo`，再写 `domain/sidebarTree` 纯逻辑，接着完成 `useSidebar`，最后在 `App.tsx` 中组合，并将打开文件的调用统一到 `openFileInNewTab`。