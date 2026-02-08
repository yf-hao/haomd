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
export async function insertMarkdownAtCursorBelow(_text: string): Promise<void> {
  // 占位实现：仅定义调用约定，不做任何实际操作。
  // 后续可以在此处调用实际编辑器 API，例如通过全局对象或依赖注入获得编辑器实例。
}
