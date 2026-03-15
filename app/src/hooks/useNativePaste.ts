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
      console.log('[useNativePaste] native://paste handler fired, view =', view, 'len=', text?.length)
      if (!text) return

      if (typeof document !== 'undefined') {
        const active = document.activeElement

        // 焦点在可编辑输入控件上（如 search-bar 输入框）：优先将文本粘贴到该输入内
        if (active && !(view && view.dom.contains(active))) {
          if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
            const el = active
            const start = el.selectionStart ?? el.value.length
            const end = el.selectionEnd ?? el.value.length
            const value = el.value
            const next = value.slice(0, start) + text + value.slice(end)

            el.value = next

            const caret = start + text.length
            try {
              el.setSelectionRange(caret, caret)
            } catch {
              // 某些类型的输入控件可能不支持 setSelectionRange，忽略即可
            }

            // 触发 input 事件，通知 React 等上层受控逻辑
            el.dispatchEvent(new Event('input', { bubbles: true }))
            console.log('[native://paste] inserted into active input outside editor')
            return
          }

          console.log('[native://paste] skip: active element is outside editor and not editable input')
          return
        }
      }

      // 其余情况：仅在编辑器视图就绪时，将文本粘贴到编辑器
      if (!view) return

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
