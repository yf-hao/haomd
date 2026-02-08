// Clipboard service abstraction for AI-related features
// 统一封装复制文本到剪贴板的行为，便于在不同平台下切换实现。

export async function copyTextToClipboard(text: string): Promise<void> {
  if (!text) return

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
  } catch {
    // ignore and try fallback
  }

  // TODO: 如果需要，可以在此处集成 Tauri 的剪贴板 API 作为降级方案
  // 当前先静默失败，避免在 UI 层产生额外错误处理负担。
}
