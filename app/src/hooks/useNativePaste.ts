import { useEffect, type RefObject } from 'react'
import type { EditorView } from '@codemirror/view'
import {
  dispatchNativePasteImage,
  onNativePaste,
  onNativePasteError,
} from '../modules/platform/clipboardEvents'
import {
  readClipboardForMatchStyle,
  readClipboardForPaste,
} from '../modules/platform/clipboardPasteService'
import { isTauriEnv } from '../modules/platform/runtime'

export interface NativePasteHandlers {
  /** 尝试粘贴剪贴板中的图片。如果成功返回 true，失败或剪贴板无图片返回 false */
  tryPasteImage?: () => Promise<boolean>
  /** 处理“粘贴并匹配样式”产生的 HTML 剪贴板内容。 */
  pasteMatchStyle?: (
    content: { html: string; text: string },
    expectedView: EditorView | null,
  ) => Promise<boolean>
  onPasteMatchStyleUnavailable?: () => void
}

/**
 * 将 Tauri 原生粘贴事件桥接到 CodeMirror 编辑器。
 */
export function useNativePaste(
  editorViewRef: RefObject<EditorView | null>,
  setStatusMessage: (msg: string) => void,
  handlers?: NativePasteHandlers,
  getEditorView?: () => EditorView | null,
) {
  const tryPasteImage = handlers?.tryPasteImage
  const pasteMatchStyle = handlers?.pasteMatchStyle
  const onPasteMatchStyleUnavailable = handlers?.onPasteMatchStyleUnavailable

  useEffect(() => {
    const getCurrentView = () => getEditorView ? getEditorView() : editorViewRef.current
    let detachPreventDefaultPaste: (() => void) | undefined
    let specialPasteInFlight = false
    let lastFocusedEditorElement: HTMLElement | null = null
    let lastEditorFocusAt = 0

    const rememberEditorFocus = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const currentView = getCurrentView()
      if (currentView?.dom.contains(target) || target.closest('.wysiwyg-editor')) {
        lastFocusedEditorElement = target
        lastEditorFocusAt = Date.now()
      }
    }
    document.addEventListener('focusin', rememberEditorFocus, true)

    // Windows WebView2 does not reliably fire paste events for images, and its
    // built-in accelerator handling intercepts Ctrl+V before Tauri menu items
    // receive it. We therefore intercept at the keydown level (which Chromium
    // respects) and read the clipboard via Tauri invoke.
    // macOS/Linux: the standard paste event works for both text and images.
    const isWindows = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)

    const insertText = (text: string, expectedView?: EditorView | null) => {
      const currentView = getCurrentView()
      if (
        !currentView ||
        currentView.dom.isConnected === false ||
        (expectedView && currentView !== expectedView)
      ) {
        return
      }
      const { state } = currentView
      currentView.dispatch(state.update({
        ...state.replaceSelection(text),
        userEvent: 'input.paste',
        scrollIntoView: true,
      }))
    }

    if (isTauriEnv() && isWindows) {
      const handleKeyDown = async (event: KeyboardEvent) => {
        const currentView = getCurrentView()
        if ((!event.ctrlKey && !event.metaKey) || (event.key !== 'v' && event.key !== 'V')) return

        const active = typeof document !== 'undefined' ? document.activeElement : null
        if (!active || !currentView || !currentView.dom.contains(active)) return
        if (event.shiftKey) {
          // Let useCommandSystem dispatch the special-paste command. Handling
          // it here would bypass its native-menu duplicate suppression.
          return
        }

        // 优先尝试图片粘贴（合并路径：一次 IPC 完成检测+保存）
        if (tryPasteImage) {
          try {
            const pasted = await tryPasteImage()
            if (pasted) {
              event.preventDefault()
              event.stopPropagation()
              return
            }
          } catch (err) {
            console.error('[useNativePaste] tryPasteImage error:', err)
          }
        }

        event.preventDefault()
        event.stopPropagation()

        void readClipboardForPaste()
          .then((content) => {
            if (getCurrentView() !== currentView) return
            if (content.kind === 'image') {
              return dispatchNativePasteImage()
            }
            if (content.kind !== 'text' || !content.text) {
              console.warn('[useNativePaste] unexpected/empty clipboard content')
              return
            }
            insertText(content.text, currentView)
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

    if (isTauriEnv() && !isWindows) {
      const handlePaste = (event: ClipboardEvent) => {
        const currentView = getCurrentView()
        const active = typeof document !== 'undefined' ? document.activeElement : null
        if (!active || !currentView || !currentView.dom.contains(active)) return
        event.preventDefault()
        event.stopPropagation()

        void readClipboardForPaste()
          .then((content) => {
            if (getCurrentView() !== currentView) return
            if (content.kind === 'image') {
              return dispatchNativePasteImage()
            }
            if (content.kind !== 'text' || !content.text) return
            insertText(content.text, currentView)
          })
          .catch((err) => {
            setStatusMessage(err instanceof Error ? err.message : String(err))
          })
      }

      document.addEventListener('paste', handlePaste, true)
      detachPreventDefaultPaste = () => {
        document.removeEventListener('paste', handlePaste, true)
      }
    }

    const handleSpecialPasteRequest = () => {
      let currentView = getCurrentView()
      let active = typeof document !== 'undefined' ? document.activeElement : null
      if (
        active === document.body &&
        lastFocusedEditorElement?.isConnected &&
        Date.now() - lastEditorFocusAt <= 1000
      ) {
        lastFocusedEditorElement.focus()
        active = document.activeElement
        currentView = getCurrentView()
      }
      const inSourceEditor = Boolean(active && currentView?.dom.contains(active))
      const inWysiwygEditor = Boolean(active?.closest('.wysiwyg-editor'))
      if ((!currentView || !inSourceEditor) && !inWysiwygEditor) return
      if (!pasteMatchStyle) {
        onPasteMatchStyleUnavailable?.()
        return
      }
      if (specialPasteInFlight) return
      specialPasteInFlight = true

      void readClipboardForMatchStyle()
        .then((content) => {
          if (!content.html && !content.text) {
            onPasteMatchStyleUnavailable?.()
            return
          }
          return pasteMatchStyle(content, currentView).then((inserted) => {
            if (!inserted) onPasteMatchStyleUnavailable?.()
          })
        })
        .catch((err) => {
          console.warn('[useNativePaste] native match-style paste failed', err)
          setStatusMessage(err instanceof Error ? err.message : String(err))
        })
        .finally(() => {
          specialPasteInFlight = false
        })
    }

    window.addEventListener('haomd:paste-match-style', handleSpecialPasteRequest)

    const unPaste = onNativePaste((text) => {
      const view = getCurrentView()
      if (!text) return

      if (typeof document !== 'undefined') {
        const active = document.activeElement

        // 焦点在可编辑输入控件上（如 search-bar 输入框）：优先将文本粘贴到该输入内
        // textarea 由各组件自行处理（通过 onNativePaste + setInput），此处仅处理 input
        if (active && !(view && view.dom.contains(active))) {
          if (active instanceof HTMLElement && active.closest('.modal')) {
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
            return
          }

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
      document.removeEventListener('focusin', rememberEditorFocus, true)
      window.removeEventListener('haomd:paste-match-style', handleSpecialPasteRequest)
      unPaste()
      unError()
    }
  }, [
    editorViewRef,
    getEditorView,
    setStatusMessage,
    onPasteMatchStyleUnavailable,
    pasteMatchStyle,
    tryPasteImage,
  ])
}
