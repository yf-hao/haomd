import { useEffect, type RefObject } from 'react'
import type { EditorView } from '@codemirror/view'
import { onNativePaste, onNativePasteError } from '../modules/platform/clipboardEvents'
import { isTauriEnv } from '../modules/platform/runtime'

/**
 * 将 Tauri 原生粘贴事件桥接到 CodeMirror 编辑器。
 */
export function useNativePaste(
  editorViewRef: RefObject<EditorView | null>,
  setStatusMessage: (msg: string) => void,
) {
  useEffect(() => {
    const view = editorViewRef.current
    let detachPreventDefaultPaste: (() => void) | undefined

    if (isTauriEnv() && view) {
      const handlePaste = (event: ClipboardEvent) => {
        const active = typeof document !== 'undefined' ? document.activeElement : null
        if (!active || !view.dom.contains(active)) return
        event.preventDefault()
        event.stopPropagation()
      }

      const handleBeforeInput = (event: InputEvent) => {
        if (event.inputType !== 'insertFromPaste') return
        const active = typeof document !== 'undefined' ? document.activeElement : null
        if (!active || !view.dom.contains(active)) return
        event.preventDefault()
        event.stopPropagation()
      }

      view.dom.addEventListener('paste', handlePaste, true)
      view.dom.addEventListener('beforeinput', handleBeforeInput, true)
      detachPreventDefaultPaste = () => {
        view.dom.removeEventListener('paste', handlePaste, true)
        view.dom.removeEventListener('beforeinput', handleBeforeInput, true)
      }
    }

    const unPaste = onNativePaste((text) => {
      const view = editorViewRef.current
      console.log('[useNativePaste] native://paste handler fired, view =', view, 'len=', text?.length)
      if (!text) return

      if (typeof document !== 'undefined') {
        const active = document.activeElement

        // 焦点在可编辑输入控件上（如 search-bar 输入框）：优先将文本粘贴到该输入内
        // textarea 由各组件自行处理（通过 onNativePaste + setInput），此处仅处理 input
        if (active && !(view && view.dom.contains(active))) {
          if (active instanceof HTMLElement && active.closest('.modal')) {
            console.log('[native://paste] skip: active element is inside modal dialog')
            return
          }

          if (active instanceof HTMLInputElement) {
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
      view.dispatch(state.update({
        ...state.replaceSelection(text),
        userEvent: 'input.paste',
        scrollIntoView: true,
      }))
    })

    const unError = onNativePasteError((message) => {
      setStatusMessage(message || '粘贴失败：无法读取剪贴板')
    })

    return () => {
      detachPreventDefaultPaste?.()
      unPaste()
      unError()
    }
  }, [editorViewRef, setStatusMessage])
}
