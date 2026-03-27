import { useEffect, useRef, useCallback, useMemo, type CSSProperties, type ChangeEvent } from 'react'
import { Editor, rootCtx, defaultValueCtx, schemaCtx } from '@milkdown/kit/core'
import { commandsCtx, editorViewCtx, prosePluginsCtx } from '@milkdown/core'
import { commonmark, codeBlockSchema, imageSchema } from '@milkdown/kit/preset/commonmark'
import { codeBlockKeymap } from '@milkdown/preset-commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { indent } from '@milkdown/kit/plugin/indent'
import { trailing } from '@milkdown/kit/plugin/trailing'
import { replaceAll, getMarkdown, $view } from '@milkdown/kit/utils'
import { headingSchema, paragraphSchema, strongSchema } from '@milkdown/preset-commonmark'
import { insertTableCommand, strikethroughSchema } from '@milkdown/preset-gfm'
import { setBlockType, toggleMark } from '@milkdown/prose/commands'
import { keymap as createKeymap } from '@milkdown/prose/keymap'
import { TextSelection } from '@milkdown/prose/state'
import type { Node as ProseMirrorNode, NodeType as ProseMirrorNodeType } from '@milkdown/prose/model'
import type { EditorView } from '@milkdown/prose/view'
import { nord } from '@milkdown/theme-nord'
import { ProsemirrorAdapterProvider, useNodeViewFactory } from '@prosemirror-adapter/react'
import { useThemeContext } from '../../modules/theme/ThemeContext'
import type { LayoutType } from '../../hooks/useWorkspaceLayout'
import {
  buildBackgroundImageVars,
  resolveManagedBackgroundImageUrl,
} from '../../modules/theme/backgroundImageRuntime'
import { mathPlugin, mathBlockSchema, mathInlineNode } from './plugins/mathPlugin'
import { MathBlockView } from './views/MathBlockView'
import { InlineMathView } from './views/InlineMathView'
import { CodeBlockView } from './views/CodeBlockView'
import { ImageView } from './views/ImageView'
import { normalizeCodeBlockLanguage } from './codeLanguage'
import './WysiwygPane.css'

export interface WysiwygPaneProps {
  value: string
  onChange: (markdown: string) => void
  filePath?: string | null
  effectiveLayout: LayoutType
  editorZoom?: number
  onSelectionGetterReady?: (getter: (() => string | null) | null) => void
  onFormatActionsReady?: (actions: WysiwygFormatActions | null) => void
  onMarkdownGetterReady?: (getter: (() => string) | null) => void
  onOutlineNavigatorReady?: (navigator: ((target: { headingIndex: number; text: string; level: 1 | 2 | 3 | 4 | 5 | 6 }) => boolean) | null) => void
  /** Called with a flush function when the editor mounts, null on unmount.
   *  Calling flush() synchronously serializes the current ProseMirror doc
   *  and pushes it through onChange — useful before save / tab-close. */
  onFlushReady?: (flush: (() => void) | null) => void
  /** Called immediately when the Milkdown doc changes (200ms debounce),
   *  before the idle-time serialization runs. */
  onDirty?: () => void
}

export interface WysiwygFormatActions {
  setHeading: (level: 0 | 1 | 2 | 3 | 4 | 5 | 6) => void
  toggleBold: () => void
  toggleStrikethrough: () => void
  insertCodeBlock: () => void
  insertTable: (rows: number, cols: number) => void
}

type IdleHandle = number

function requestIdleWork(callback: () => void, timeout = 2000): IdleHandle {
  const win = window as Window & typeof globalThis & {
    requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number
  }
  if (typeof win.requestIdleCallback === 'function') {
    return win.requestIdleCallback(callback, { timeout })
  }
  return window.setTimeout(callback, 1)
}

function cancelIdleWork(handle: IdleHandle | null) {
  if (handle === null) return
  const win = window as Window & typeof globalThis & {
    cancelIdleCallback?: (id: number) => void
  }
  if (typeof win.cancelIdleCallback === 'function') {
    win.cancelIdleCallback(handle)
    return
  }
  window.clearTimeout(handle)
}

// Persist last used code block language across insertions
let lastUsedCodeBlockLanguage = ''
// Dedup guard: prevent double-fire from ProseMirror keymap + Tauri menu
let lastCodeBlockInsertTime = 0

export function setLastUsedCodeBlockLanguage(lang: string) {
  const normalized = normalizeCodeBlockLanguage(lang)
  if (normalized) lastUsedCodeBlockLanguage = normalized
}

type CodeBlockSnapshot = {
  pos: number
  raw: unknown
  normalized: string
  textPreview: string
}

function collectCodeBlocks(doc: ProseMirrorNode, codeBlockType: ProseMirrorNodeType): CodeBlockSnapshot[] {
  const blocks: CodeBlockSnapshot[] = []
  doc.descendants((node, pos) => {
    if (node.type !== codeBlockType) return
    blocks.push({
      pos,
      raw: node.attrs.language,
      normalized: normalizeCodeBlockLanguage(node.attrs.language),
      textPreview: node.textContent.slice(0, 80),
    })
  })
  return blocks
}

function findInheritedCodeBlockLanguage(blocks: CodeBlockSnapshot[], anchorPos: number): string {
  let nearestLanguage = ''
  for (const block of blocks) {
    if (block.pos > anchorPos) break
    if (block.normalized) nearestLanguage = block.normalized
  }

  if (nearestLanguage) return nearestLanguage

  for (const block of blocks) {
    if (block.normalized) nearestLanguage = block.normalized
  }

  return nearestLanguage
}

function insertInheritedCodeBlock(
  view: EditorView,
  codeBlockType: ProseMirrorNodeType,
): boolean {
  // Dedup guard: skip if another insertion just happened (< 200ms)
  const now = Date.now()
  if (now - lastCodeBlockInsertTime < 200) return true
  lastCodeBlockInsertTime = now

  const { state } = view
  const { doc, selection } = state

  // If cursor is already inside a code block, don't nest — just exit
  const $from = selection.$from
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type === codeBlockType) return false
  }

  const beforeBlocks = collectCodeBlocks(doc, codeBlockType)
  const inheritedLanguage =
    findInheritedCodeBlockLanguage(beforeBlocks, selection.from) || lastUsedCodeBlockLanguage

  if (inheritedLanguage) lastUsedCodeBlockLanguage = inheritedLanguage

  const newNode = codeBlockType.create({ language: inheritedLanguage || '' })
  let tr = state.tr.replaceSelectionWith(newNode, false)

  // Verify the transaction actually changed the document
  if (!tr.docChanged) return false

  const blocksAfterInsert = collectCodeBlocks(tr.doc, codeBlockType)
  const beforeBlockPositions = new Set(beforeBlocks.map((block) => block.pos))
  const insertedBlock =
    blocksAfterInsert.find((block) => !beforeBlockPositions.has(block.pos)) ??
    blocksAfterInsert[blocksAfterInsert.length - 1] ??
    null

  if (insertedBlock && inheritedLanguage && insertedBlock.normalized !== inheritedLanguage) {
    tr = tr.setNodeAttribute(insertedBlock.pos, 'language', inheritedLanguage)
  }

  if (insertedBlock) {
    tr = tr.setSelection(TextSelection.create(tr.doc, insertedBlock.pos + 1))
  }

  view.dispatch(tr.scrollIntoView())
  view.focus()
  return true
}

/**
 * Outer wrapper — provides ProsemirrorAdapterProvider context.
 */
export function WysiwygPane(props: WysiwygPaneProps) {
  return (
    <ProsemirrorAdapterProvider>
      <WysiwygEditor {...props} />
    </ProsemirrorAdapterProvider>
  )
}

function isPlainTextFile(path: string | null | undefined): boolean {
  if (!path) return false
  return path.toLowerCase().endsWith('.txt')
}

function PlainTextWysiwyg({
  value,
  onChange,
  effectiveLayout,
  editorZoom,
  onSelectionGetterReady,
  onFormatActionsReady,
  onMarkdownGetterReady,
  onOutlineNavigatorReady,
}: WysiwygPaneProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const { themeSettings, resolvedMode } = useThemeContext()
  const isDark = resolvedMode === 'dark'
  const wysiwygBackground = themeSettings.workspaceBackground
  const wysiwygBackgroundUrl = useMemo(
    () => resolveManagedBackgroundImageUrl(wysiwygBackground?.path),
    [wysiwygBackground?.path],
  )
  const wysiwygBackgroundStyle = useMemo(
    () => buildBackgroundImageVars(wysiwygBackground, { maxOpacity: 0.4 }),
    [wysiwygBackground],
  )
  const hasWysiwygBackground = Boolean(wysiwygBackground?.enabled && wysiwygBackgroundUrl)
  const wysiwygBackgroundFitClass = wysiwygBackground?.enabled
    ? wysiwygBackground.size === 'contain'
      ? 'wysiwyg-bg-fit-contain'
      : wysiwygBackground.size === 'height-fill'
        ? 'wysiwyg-bg-fit-height-fill'
        : wysiwygBackground.size === 'width-fill'
          ? 'wysiwyg-bg-fit-width-fill'
          : wysiwygBackground.size === 'auto'
            ? 'wysiwyg-bg-fit-auto'
            : ''
    : ''

  useEffect(() => {
    const getter = () => {
      const textarea = textareaRef.current
      if (!textarea) return null
      const { selectionStart, selectionEnd, value: currentValue } = textarea
      if (selectionStart === selectionEnd) return null
      const text = currentValue.slice(selectionStart, selectionEnd).trim()
      return text || null
    }

    onSelectionGetterReady?.(getter)
    return () => onSelectionGetterReady?.(null)
  }, [onSelectionGetterReady])

  useEffect(() => {
    onFormatActionsReady?.(null)
    return () => onFormatActionsReady?.(null)
  }, [onFormatActionsReady])

  useEffect(() => {
    onOutlineNavigatorReady?.(null)
    return () => onOutlineNavigatorReady?.(null)
  }, [onOutlineNavigatorReady])

  useEffect(() => {
    const getter = () => textareaRef.current?.value ?? value
    onMarkdownGetterReady?.(getter)
    return () => onMarkdownGetterReady?.(null)
  }, [onMarkdownGetterReady, value])

  const style: CSSProperties & { '--wysiwyg-zoom'?: string } = {}
  if (effectiveLayout === 'preview-only') {
    style.gridColumn = '1 / -1'
    style.gridRow = '1 / 2'
  }
  style['--wysiwyg-zoom'] = String(editorZoom ?? 1)

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(event.target.value)
  }

  return (
    <section
      className={`pane wysiwyg-pane plain-text ${isDark ? 'dark' : 'light'} ${hasWysiwygBackground ? 'has-wysiwyg-background' : ''} ${wysiwygBackgroundFitClass}`.trim()}
      style={{ ...style, ...wysiwygBackgroundStyle }}
    >
      {hasWysiwygBackground ? (
        <>
          <img className="wysiwyg-background" src={wysiwygBackgroundUrl ?? ''} alt="" aria-hidden="true" />
          <div className="wysiwyg-background-overlay" aria-hidden="true" />
        </>
      ) : null}
      <div className="wysiwyg-editor">
        <textarea
          ref={textareaRef}
          className="wysiwyg-plain-textarea"
          value={value}
          onChange={handleChange}
          spellCheck={false}
        />
      </div>
    </section>
  )
}

/**
 * Inner component — uses useNodeViewFactory (requires ProsemirrorAdapterProvider ancestor).
 */
function WysiwygEditor({
  value,
  onChange,
  filePath,
  effectiveLayout,
  editorZoom,
  onSelectionGetterReady,
  onFormatActionsReady,
  onMarkdownGetterReady,
  onOutlineNavigatorReady,
  onFlushReady,
  onDirty,
}: WysiwygPaneProps) {
  if (isPlainTextFile(filePath)) {
    return (
      <PlainTextWysiwyg
        value={value}
        onChange={onChange}
        filePath={filePath}
        effectiveLayout={effectiveLayout}
        editorZoom={editorZoom}
        onSelectionGetterReady={onSelectionGetterReady}
        onMarkdownGetterReady={onMarkdownGetterReady}
        onOutlineNavigatorReady={onOutlineNavigatorReady}
      />
    )
  }

  const editorRef = useRef<Editor | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const initRunIdRef = useRef(0)
  const { themeSettings, resolvedMode } = useThemeContext()
  const isDark = resolvedMode === 'dark'
  const wysiwygBackground = themeSettings.workspaceBackground
  const wysiwygBackgroundUrl = useMemo(
    () => resolveManagedBackgroundImageUrl(wysiwygBackground?.path),
    [wysiwygBackground?.path],
  )
  const wysiwygBackgroundStyle = useMemo(
    () => buildBackgroundImageVars(wysiwygBackground, { maxOpacity: 0.4 }),
    [wysiwygBackground],
  )
  const hasWysiwygBackground = Boolean(wysiwygBackground?.enabled && wysiwygBackgroundUrl)
  const wysiwygBackgroundFitClass = wysiwygBackground?.enabled
    ? wysiwygBackground.size === 'contain'
      ? 'wysiwyg-bg-fit-contain'
      : wysiwygBackground.size === 'height-fill'
        ? 'wysiwyg-bg-fit-height-fill'
        : wysiwygBackground.size === 'width-fill'
          ? 'wysiwyg-bg-fit-width-fill'
          : wysiwygBackground.size === 'auto'
            ? 'wysiwyg-bg-fit-auto'
            : ''
    : ''
  const nodeViewFactory = useNodeViewFactory()

  const valueRef = useRef(value)
  valueRef.current = value
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const filePathRef = useRef(filePath)
  filePathRef.current = filePath
  const onFlushReadyRef = useRef(onFlushReady)
  onFlushReadyRef.current = onFlushReady
  const onDirtyRef = useRef(onDirty)
  onDirtyRef.current = onDirty
  const onSelectionGetterReadyRef = useRef(onSelectionGetterReady)
  onSelectionGetterReadyRef.current = onSelectionGetterReady
  const onMarkdownGetterReadyRef = useRef(onMarkdownGetterReady)
  onMarkdownGetterReadyRef.current = onMarkdownGetterReady
  const onFormatActionsReadyRef = useRef(onFormatActionsReady)
  onFormatActionsReadyRef.current = onFormatActionsReady
  const onOutlineNavigatorReadyRef = useRef(onOutlineNavigatorReady)
  onOutlineNavigatorReadyRef.current = onOutlineNavigatorReady

  const isInternalUpdate = useRef(false)
  // Track the last value we synced TO the editor (to avoid needless getMarkdown)
  const lastSyncedValueRef = useRef(value)
  const hasUserInteractedRef = useRef(false)
  const idleCallbackRef = useRef<IdleHandle | null>(null)
  const delayedSyncTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)

  // Capture nodeViewFactory in a ref so initEditor callback doesn't change
  const nodeViewFactoryRef = useRef(nodeViewFactory)
  nodeViewFactoryRef.current = nodeViewFactory

  const getCurrentMarkdown = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return valueRef.current
    return editor.action(getMarkdown())
  }, [])

  // Serialize the current ProseMirror doc and push it through onChange.
  const serializeAndPush = useCallback((requireInteraction = true) => {
    const editor = editorRef.current
    if (!editor) return
    if (requireInteraction && !hasUserInteractedRef.current) return
    const md = getCurrentMarkdown()
    if (md !== valueRef.current) {
      isInternalUpdate.current = true
      lastSyncedValueRef.current = md
      onChangeRef.current(md)
      queueMicrotask(() => { isInternalUpdate.current = false })
    }
  }, [getCurrentMarkdown])

  const flushPending = useCallback(() => {
    if (idleCallbackRef.current !== null) {
      cancelIdleWork(idleCallbackRef.current)
      idleCallbackRef.current = null
    }
    if (delayedSyncTimerRef.current !== null) {
      window.clearTimeout(delayedSyncTimerRef.current)
      delayedSyncTimerRef.current = null
    }
    serializeAndPush(false)
  }, [serializeAndPush])

  const scheduleDelayedSync = useCallback((delayMs = 180) => {
    if (delayedSyncTimerRef.current !== null) {
      window.clearTimeout(delayedSyncTimerRef.current)
      delayedSyncTimerRef.current = null
    }
    if (idleCallbackRef.current !== null) {
      cancelIdleWork(idleCallbackRef.current)
      idleCallbackRef.current = null
    }
    delayedSyncTimerRef.current = window.setTimeout(() => {
      delayedSyncTimerRef.current = null
      serializeAndPush()
    }, delayMs)
  }, [serializeAndPush])

  const runAction = useCallback((runner: (editor: Editor) => void) => {
    const editor = editorRef.current
    if (!editor) return

    hasUserInteractedRef.current = true
    runner(editor)
    scheduleDelayedSync()
  }, [scheduleDelayedSync])

  const insertCodeBlockWithInheritedLanguage = useCallback((editor: Editor) => {
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const codeBlockType = codeBlockSchema.type(ctx)
      insertInheritedCodeBlock(view, codeBlockType)
    })
  }, [])

  const navigateToHeadingByIndex = useCallback((target: { headingIndex: number; text: string; level: 1 | 2 | 3 | 4 | 5 | 6 }) => {
    const editor = editorRef.current
    if (!editor || target.headingIndex < 0) return false

    const container = containerRef.current
    const headingElements = container?.querySelectorAll<HTMLElement>(
      '.milkdown h1, .milkdown h2, .milkdown h3, .milkdown h4, .milkdown h5, .milkdown h6',
    )
    const headingList = headingElements ? Array.from(headingElements) : []
    const normalizedText = target.text.trim()
    const targetHeadingElement =
      headingList[target.headingIndex] ??
      headingList.find((element) => {
        const elementLevel = Number(element.tagName.slice(1))
        const elementText = element.textContent?.trim() ?? ''
        return elementLevel === target.level && elementText === normalizedText
      }) ??
      null

    if (targetHeadingElement && container) {
      const targetScrollTop = Math.max(
        0,
        targetHeadingElement.offsetTop - Math.max(24, Math.round(container.clientHeight * 0.18)),
      )
      container.scrollTo({ top: targetScrollTop, behavior: 'auto' })

      let didNavigate = false
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        try {
          const targetPos = view.posAtDOM(targetHeadingElement, 0)
          const tr = view.state.tr
            .setSelection(TextSelection.create(view.state.doc, Math.max(1, targetPos + 1)))
            .scrollIntoView()
          view.dispatch(tr)
          view.focus()
          didNavigate = true
        } catch {
          targetHeadingElement.scrollIntoView({ block: 'center', behavior: 'auto' })
          targetHeadingElement.focus?.()
          didNavigate = true
        }
      })
      return didNavigate
    }

    let didNavigate = false
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const headingType = headingSchema.type(ctx)
      let currentIndex = -1
      let targetPos: number | null = null

      view.state.doc.descendants((node, pos) => {
        if (node.type !== headingType) return
        currentIndex += 1
        if (currentIndex === target.headingIndex) {
          targetPos = pos
          return false
        }
      })

      if (targetPos === null) return

      const tr = view.state.tr
        .setSelection(TextSelection.create(view.state.doc, targetPos + 1))
        .scrollIntoView()
      view.dispatch(tr)
      view.focus()
      didNavigate = true
    })

    return didNavigate
  }, [])

  const initEditor = useCallback(async () => {
    if (!containerRef.current) return
    const runId = ++initRunIdRef.current

    const nvFactory = nodeViewFactoryRef.current

    // Build node views using the React adapter factory
    const mathBlockView = $view(mathBlockSchema.node, () =>
      nvFactory({ component: MathBlockView }),
    )
    const mathInlineView = $view(mathInlineNode, () =>
      nvFactory({ component: InlineMathView }),
    )
    const codeBlockView = $view(codeBlockSchema.node, () =>
      nvFactory({ component: CodeBlockView }),
    )
    const imageView = $view(imageSchema.node, () =>
      nvFactory({
        component: () => <ImageView filePath={filePathRef.current} />,
      }),
    )

    const editor = await Editor.make()
      .config(nord)
      .config((ctx) => {
        ctx.set(rootCtx, containerRef.current!)
        ctx.set(defaultValueCtx, valueRef.current)

        // Disable Milkdown's built-in Mod-Alt-c keymap — we handle it ourselves
        // via both the Tauri menu accelerator and our custom ProseMirror keymap.
        ctx.set(codeBlockKeymap.key, {
          CreateCodeBlock: { shortcuts: '' },
        })

        ctx.update(prosePluginsCtx, (plugins) => [
          createKeymap({
            'Mod-Alt-c': (_state, _dispatch, view) => {
              if (!view) return false
              const codeBlockType = ctx.get(schemaCtx).nodes[codeBlockSchema.id]
              if (!codeBlockType) return false
              hasUserInteractedRef.current = true
              const inserted = insertInheritedCodeBlock(view, codeBlockType)
              if (inserted) scheduleDelayedSync()
              return inserted
            },
          }),
          ...plugins,
        ])

        ctx.get(listenerCtx).updated((_ctx, _doc, _prevDoc) => {
          if (!hasUserInteractedRef.current) return

          onDirtyRef.current?.()
          if (idleCallbackRef.current !== null) {
            cancelIdleWork(idleCallbackRef.current)
            idleCallbackRef.current = null
          }
          idleCallbackRef.current = requestIdleWork(() => {
            idleCallbackRef.current = null
            serializeAndPush()
          }, 2000)
        })
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(listener)
      .use(clipboard)
      .use(indent)
      .use(trailing)
      // Math support
      .use(mathPlugin)
      .use(mathBlockView)
      .use(mathInlineView)
      // Custom code block view (Mermaid / Mind / plain)
      .use(codeBlockView)
      // Custom image view (local path resolution)
      .use(imageView)
      .create()

    if (runId !== initRunIdRef.current) {
      editor.destroy()
      return
    }

    editorRef.current?.destroy()
    editorRef.current = editor
  }, [scheduleDelayedSync, serializeAndPush])

  useEffect(() => {
    onFlushReadyRef.current?.(flushPending)
    return () => {
      onFlushReadyRef.current?.(null)
    }
  }, [flushPending])

  useEffect(() => {
    onMarkdownGetterReadyRef.current?.(getCurrentMarkdown)
    return () => onMarkdownGetterReadyRef.current?.(null)
  }, [getCurrentMarkdown])

  useEffect(() => {
    onOutlineNavigatorReadyRef.current?.(navigateToHeadingByIndex)
    return () => onOutlineNavigatorReadyRef.current?.(null)
  }, [navigateToHeadingByIndex])

  useEffect(() => {
    const actions: WysiwygFormatActions = {
      setHeading: (level) => {
        runAction((editor) => {
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx)
            const command = level === 0
              ? setBlockType(paragraphSchema.type(ctx))
              : setBlockType(headingSchema.type(ctx), { level })
            command(view.state, view.dispatch, view)
            view.focus()
          })
        })
      },
      toggleBold: () => {
        runAction((editor) => {
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx)
            toggleMark(strongSchema.type(ctx))(view.state, view.dispatch, view)
            view.focus()
          })
        })
      },
      toggleStrikethrough: () => {
        runAction((editor) => {
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx)
            toggleMark(strikethroughSchema.type(ctx))(view.state, view.dispatch, view)
            view.focus()
          })
        })
      },
      insertCodeBlock: () => {
        runAction((editor) => {
          insertCodeBlockWithInheritedLanguage(editor)
        })
      },
      insertTable: (rows, cols) => {
        runAction((editor) => {
          editor.action((ctx) => {
            ctx.get(commandsCtx).call(insertTableCommand.key, {
              row: Math.max(1, rows),
              col: Math.max(1, cols),
            })
            ctx.get(editorViewCtx).focus()
          })
        })
      },
    }

    onFormatActionsReadyRef.current?.(actions)
    return () => {
      onFormatActionsReadyRef.current?.(null)
    }
  }, [insertCodeBlockWithInheritedLanguage, runAction])

  useEffect(() => {
    initEditor()
    return () => {
      initRunIdRef.current += 1
      // Flush any unserialized changes before destroying the editor
      flushPending()
      hasUserInteractedRef.current = false
      onSelectionGetterReadyRef.current?.(null)
      onMarkdownGetterReadyRef.current?.(null)
      onFormatActionsReadyRef.current?.(null)
      onOutlineNavigatorReadyRef.current?.(null)
      editorRef.current?.destroy()
      editorRef.current = null
    }
  }, [flushPending, initEditor])

  // Sync external value changes (e.g. tab switch, file reload)
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || isInternalUpdate.current) return
    // Fast path: skip if value matches what we last synced
    if (value === lastSyncedValueRef.current) return

    try {
      const currentMarkdown = editor.action(getMarkdown())
      if (currentMarkdown !== value) {
        editor.action(replaceAll(value))
      }
      lastSyncedValueRef.current = value
    } catch {
      // Editor may not be fully initialized yet
    }
  }, [value])

  useEffect(() => {
    const getter = () => {
      const container = containerRef.current
      const selection = window.getSelection()
      if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) {
        return null
      }

      const anchorNode = selection.anchorNode
      const focusNode = selection.focusNode
      if (!anchorNode || !focusNode) return null
      if (!container.contains(anchorNode) || !container.contains(focusNode)) {
        return null
      }

      const text = selection.toString().trim()
      return text || null
    }

    onSelectionGetterReadyRef.current?.(getter)
    return () => onSelectionGetterReadyRef.current?.(null)
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const markUserInteracted = () => {
      hasUserInteractedRef.current = true
    }

    const handleKeydown = (e: KeyboardEvent) => {
      markUserInteracted()
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        flushPending()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        const editor = editorRef.current
        if (editor) {
          hasUserInteractedRef.current = true
          insertCodeBlockWithInheritedLanguage(editor)
          scheduleDelayedSync()
        }
      }
    }

    container.addEventListener('beforeinput', markUserInteracted)
    container.addEventListener('keydown', handleKeydown, true)
    container.addEventListener('paste', markUserInteracted)
    container.addEventListener('drop', markUserInteracted)
    container.addEventListener('compositionstart', markUserInteracted)

    return () => {
      container.removeEventListener('beforeinput', markUserInteracted)
      container.removeEventListener('keydown', handleKeydown, true)
      container.removeEventListener('paste', markUserInteracted)
      container.removeEventListener('drop', markUserInteracted)
      container.removeEventListener('compositionstart', markUserInteracted)
    }
  }, [flushPending, insertCodeBlockWithInheritedLanguage, scheduleDelayedSync])

  const style: CSSProperties & { '--wysiwyg-zoom'?: string } = {}
  if (effectiveLayout === 'preview-only') {
    style.gridColumn = '1 / -1'
    style.gridRow = '1 / 2'
  }
  style['--wysiwyg-zoom'] = String(editorZoom ?? 1)

  return (
    <section
      className={`pane wysiwyg-pane ${isDark ? 'dark' : 'light'} ${hasWysiwygBackground ? 'has-wysiwyg-background' : ''} ${wysiwygBackgroundFitClass}`.trim()}
      style={{ ...style, ...wysiwygBackgroundStyle }}
    >
      {hasWysiwygBackground ? (
        <>
          <img className="wysiwyg-background" src={wysiwygBackgroundUrl ?? ''} alt="" aria-hidden="true" />
          <div className="wysiwyg-background-overlay" aria-hidden="true" />
        </>
      ) : null}
      <div ref={containerRef} className="wysiwyg-editor" />
    </section>
  )
}
