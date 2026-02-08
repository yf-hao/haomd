// Editor insertion service abstraction for AI Chat
// 统一封装“在当前编辑区光标下一行插入 Markdown 文本”的行为。
// 具体实现依赖宿主应用的编辑器 API，本模块提供调用约定。

/**
 * 将 Markdown 文本插入到当前编辑区光标所在行的下一行。
 *
 * 具体行为约定：
 * - 若当前行非空，则在下一行追加一个换行再插入文本；
 * - 若当前行为空，则直接在当前行插入文本；
 * - 需保证 undo/redo 正常工作（由具体编辑器实现负责）。
 */
type InsertImpl = ((text: string) => void | Promise<void>) | null

let insertImpl: InsertImpl = null

/**
 * 由宿主应用注册具体的“插入到编辑器”实现。
 *
 * 通常在工作区 Shell（如 WorkspaceShell）中调用，利用实际的 EditorView 来完成插入。
 */
export function registerEditorInsertBelow(fn: (text: string) => void | Promise<void>): void {
  insertImpl = fn
}

/**
 * 在当前编辑区光标所在行的下一行插入 Markdown 文本。
 *
 * 若未注册具体实现，将输出警告但不会抛错，保证在纯 Web 环境下仍可运行。
 */
export async function insertMarkdownAtCursorBelow(text: string): Promise<void> {
  if (!insertImpl) {
    console.warn('[editorInsertService] insertMarkdownAtCursorBelow called but no implementation registered')
    return
  }
  await Promise.resolve(insertImpl(text))
}
