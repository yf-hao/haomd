import { useEffect, type RefObject } from 'react'
import type { EditorView } from '@codemirror/view'
import { onNativePaste, onNativePasteError } from '../modules/platform/clipboardEvents'

/**
 * 将 Tauri 原生粘贴事件桥接到 CodeMirror 编辑器。
 */
export function useNativePaste(
  editorViewRef: RefObject<EditorView | null>,
  setStatusMessage: (msg: string) => void,
) {
  useEffect(() => {
    const unPaste = onNativePaste((text) => {
      const view = editorViewRef.current
      console.log('[native://paste] handler fired, view =', view)
      if (!view || !text) return

      // 仅当当前焦点在编辑器内部时，才处理粘贴，避免与其他输入区域（如对话框）冲突
      if (typeof document !== 'undefined') {
        const active = document.activeElement
        if (active && !view.dom.contains(active)) {
          console.log('[native://paste] skip: active element is outside editor')
          return
        }
      }

      const { state } = view
      const tr = state.changeByRange((range) => ({
        range,
        changes: { from: range.from, to: range.to, insert: text },
      }))
      view.dispatch(tr)
    })

    const unError = onNativePasteError((message) => {
      setStatusMessage(message || '粘贴失败：无法读取剪贴板')
    })

    return () => {
      unPaste()
      unError()
    }
  }, [editorViewRef, setStatusMessage])
}
