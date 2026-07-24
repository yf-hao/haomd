import { useEffect, type RefObject } from 'react'
import type { EditorView } from '@codemirror/view'
import {
  dispatchNativePasteImage,
  onNativePaste,
  onNativePasteError,
} from '../modules/platform/clipboardEvents'
import { readClipboardForPaste } from '../modules/platform/clipboardPasteService'
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

    // Windows WebView2 does not reliably fire paste events for images, and its
    // built-in accelerator handling intercepts Ctrl+V before Tauri menu items
    // receive it. We therefore intercept at the keydown level (which Chromium
    // respects) and read the clipboard via Tauri invoke.
    // macOS/Linux: the standard paste event works for both text and images.
    const isWindows = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)

    const insertText = (text: string) => {
      const currentView = editorViewRef.current
      if (!currentView) return
      const { state } = currentView
      currentView.dispatch(state.update({
        ...state.replaceSelection(text),
        userEvent: 'input.paste',
        scrollIntoView: true,
      }))
    }

    if (isTauriEnv() && isWindows) {
      const handleKeyDown = (event: KeyboardEvent) => {
        const currentView = editorViewRef.current
        console.log('[useNativePaste] keydown on document:', event.key, 'ctrl=', event.ctrlKey, 'view=', currentView)
        if ((!event.ctrlKey && !event.metaKey) || (event.key !== 'v' && event.key !== 'V')) return

        const active = typeof document !== 'undefined' ? document.activeElement : null
        console.log('[useNativePaste] Ctrl+V, active=', active?.tagName, 'inEditor=', active ? currentView?.dom.contains(active) : false)
        if (!active || !currentView || !currentView.dom.contains(active)) return

        console.log('[useNativePaste] intercepting Ctrl+V in editor')
        event.preventDefault()
        event.stopPropagation()

        console.log('[useNativePaste] calling readClipboardForPaste()...')
        void readClipboardForPaste()
          .then((content) => {
            console.log('[useNativePaste] readClipboardForPaste returned:', JSON.stringify(content))
            if (content.kind === 'image') {
              console.log('[useNativePaste] dispatching native://paste_image')
              return dispatchNativePasteImage()
            }
            if (content.kind !== 'text' || !content.text) {
              console.warn('[useNativePaste] unexpected/empty clipboard content')
              return
            }
            console.log('[useNativePaste] inserting text, len=', content.text.length)
            insertText(content.text)
          })
          .catch((err) => {
            console.error('[useNativePaste] readClipboardForPaste error:', err)
            setStatusMessage(err instanceof Error ? err.message : String(err))
          })
      }

      // Windows WebView2 dispatches Ctrl+V keydown only to document level,
      // not to child DOM nodes. We must listen on document in capture phase.
      document.addEventListener('keydown', handleKeyDown, true)
      detachPreventDefaultPaste = () => {
        document.removeEventListener('keydown', handleKeyDown, true)
      }
    }

    if (isTauriEnv() && view && !isWindows) {
      const handlePaste = (event: ClipboardEvent) => {
        const active = typeof document !== 'undefined' ? document.activeElement : null
        if (!active || !view.dom.contains(active)) return
        event.preventDefault()
        event.stopPropagation()

        void readClipboardForPaste()
          .then((content) => {
            if (content.kind === 'image') {
              return dispatchNativePasteImage()
            }
            if (content.kind !== 'text' || !content.text) return
            insertText(content.text)
          })
          .catch((err) => {
            setStatusMessage(err instanceof Error ? err.message : String(err))
          })
      }

      view.dom.addEventListener('paste', handlePaste, true)
      detachPreventDefaultPaste = () => {
        view.dom.removeEventListener('paste', handlePaste, true)
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
