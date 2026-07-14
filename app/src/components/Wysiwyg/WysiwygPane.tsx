import { useEffect, useRef, useCallback, useMemo, useState, type CSSProperties, type ChangeEvent } from 'react'
import { Editor, rootCtx, defaultValueCtx, schemaCtx } from '@milkdown/kit/core'
import { commandsCtx, editorViewCtx, prosePluginsCtx, serializerCtx } from '@milkdown/core'
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
import { createTextColorTarget, isTextColorTargetActive, type TextColorTarget } from '../../modules/editor/textColorTarget'
import type { LayoutType } from '../../hooks/useWorkspaceLayout'
import {
  buildBackgroundImageVars,
  resolveManagedBackgroundImageUrl,
} from '../../modules/theme/backgroundImageRuntime'
import { normalizeTextColor } from '../../modules/markdown/extensions/colorMark'
import { mathPlugin, mathBlockSchema, mathInlineNode } from './plugins/mathPlugin'
import { colorMarkPlugin, textColorMark } from './plugins/colorMark'
import { MathBlockView } from './views/MathBlockView'
import { InlineMathView } from './views/InlineMathView'
import { CodeBlockView } from './views/CodeBlockView'
import { ImageView } from './views/ImageView'
import { normalizeCodeBlockLanguage } from './codeLanguage'
import { BlockCacheManager } from './blockCache'
import { composeMarkdownWithFrontMatter } from '../../modules/markdown/frontMatter'
import { onNativePaste } from '../../modules/platform/clipboardEvents'
import { buildHeadingsFromWysiwygDoc } from '../../modules/outline/wysiwygOutline'
import type { OutlineHeading } from '../../modules/outline/outlineSource'
import './WysiwygPane.css'

export interface WysiwygPaneProps {
  value: string
  frontMatterBlock?: string
  onChange: (markdown: string) => void
  filePath?: string | null
  docKey?: string | null
  effectiveLayout: LayoutType
  editorZoom?: number
  onSelectionGetterReady?: (getter: (() => string | null) | null) => void
  onFormatActionsReady?: (actions: WysiwygFormatActions | null) => void
  onMarkdownGetterReady?: (getter: (() => string) | null) => void
  onOutlineNavigatorReady?: (navigator: ((target: { headingIndex: number; text: string; level: 1 | 2 | 3 | 4 | 5 | 6 }) => boolean) | null) => void
  onOutlineItemsChange?: (items: OutlineHeading[]) => void
  skipUnmountFlushRef?: { current: boolean } | null
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
  getCurrentTextColor: () => string | null
  getCurrentTextColorTarget: () => TextColorTarget | null
  applyTextColorToTarget: (color: string | null, target: TextColorTarget) => boolean
  applyTextColor: (color: string) => void
  clearTextColor: () => void
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
  frontMatterBlock,
  onChange,
  effectiveLayout,
  editorZoom,
  onSelectionGetterReady,
  onFormatActionsReady,
  onMarkdownGetterReady,
  onOutlineNavigatorReady,
  onOutlineItemsChange,
}: WysiwygPaneProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [isFrontMatterCollapsed, setIsFrontMatterCollapsed] = useState(false)
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
    onOutlineItemsChange?.([])
    return () => onOutlineItemsChange?.([])
  }, [onOutlineItemsChange])

  useEffect(() => {
    const getter = () => composeMarkdownWithFrontMatter(frontMatterBlock, textareaRef.current?.value ?? value)
    onMarkdownGetterReady?.(getter)
    return () => onMarkdownGetterReady?.(null)
  }, [frontMatterBlock, onMarkdownGetterReady, value])

  const style: CSSProperties & { '--wysiwyg-zoom'?: string } = {}
  if (effectiveLayout === 'preview-only') {
    style.gridColumn = '1 / -1'
    style.gridRow = '1 / 2'
  }
  style['--wysiwyg-zoom'] = String(editorZoom ?? 1)

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(composeMarkdownWithFrontMatter(frontMatterBlock, event.target.value))
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
      <div className="wysiwyg-scroll">
        {frontMatterBlock ? (
          <section className="wysiwyg-frontmatter-panel">
            <button
              type="button"
              className="wysiwyg-frontmatter-toggle"
              onClick={() => setIsFrontMatterCollapsed((prev) => !prev)}
              aria-expanded={!isFrontMatterCollapsed}
            >
              <span className="wysiwyg-frontmatter-label">YAML Front Matter</span>
              <span className={`wysiwyg-frontmatter-chevron ${isFrontMatterCollapsed ? 'collapsed' : ''}`} aria-hidden="true">▾</span>
            </button>
            {!isFrontMatterCollapsed ? (
              <textarea
                className="wysiwyg-frontmatter-textarea"
                value={frontMatterBlock}
                onChange={(event) => onChange(composeMarkdownWithFrontMatter(event.target.value, value))}
                spellCheck={false}
              />
            ) : null}
          </section>
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
      </div>
    </section>
  )
}

/**
 * Inner component — uses useNodeViewFactory (requires ProsemirrorAdapterProvider ancestor).
 */
function WysiwygEditor({
  value,
  frontMatterBlock,
  onChange,
  filePath,
  docKey,
  effectiveLayout,
  editorZoom,
  onSelectionGetterReady,
  onFormatActionsReady,
  onMarkdownGetterReady,
  onOutlineNavigatorReady,
  onOutlineItemsChange,
  skipUnmountFlushRef,
  onFlushReady,
  onDirty,
}: WysiwygPaneProps) {
  const [isFrontMatterCollapsed, setIsFrontMatterCollapsed] = useState(false)
  if (isPlainTextFile(filePath)) {
    return (
      <PlainTextWysiwyg
        value={value}
        frontMatterBlock={frontMatterBlock}
        onChange={onChange}
        filePath={filePath}
        docKey={docKey}
        effectiveLayout={effectiveLayout}
        editorZoom={editorZoom}
        onSelectionGetterReady={onSelectionGetterReady}
        onMarkdownGetterReady={onMarkdownGetterReady}
        onOutlineNavigatorReady={onOutlineNavigatorReady}
        onOutlineItemsChange={onOutlineItemsChange}
      />
    )
  }

  const editorRef = useRef<Editor | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
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
  const frontMatterBlockRef = useRef(frontMatterBlock ?? '')
  frontMatterBlockRef.current = frontMatterBlock ?? ''
  const onSelectionGetterReadyRef = useRef(onSelectionGetterReady)
  onSelectionGetterReadyRef.current = onSelectionGetterReady
  const onMarkdownGetterReadyRef = useRef(onMarkdownGetterReady)
  onMarkdownGetterReadyRef.current = onMarkdownGetterReady
  const onFormatActionsReadyRef = useRef(onFormatActionsReady)
  onFormatActionsReadyRef.current = onFormatActionsReady
  const onOutlineNavigatorReadyRef = useRef(onOutlineNavigatorReady)
  onOutlineNavigatorReadyRef.current = onOutlineNavigatorReady
  const onOutlineItemsChangeRef = useRef(onOutlineItemsChange)
  onOutlineItemsChangeRef.current = onOutlineItemsChange
  const lastOutlineItemsRef = useRef<OutlineHeading[]>([])

  const isInternalUpdate = useRef(false)
  const textColorTargetRef = useRef<TextColorTarget | null>(null)
  const preserveTextColorTargetOnNextDocChangeRef = useRef(false)
  // Track the last value we synced TO the editor (to avoid needless getMarkdown)
  const lastSyncedValueRef = useRef(value)
  const hasUserInteractedRef = useRef(false)
  const idleCallbackRef = useRef<IdleHandle | null>(null)
  const delayedSyncTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const outlineEmitFrameRef = useRef<number | null>(null)
  const initialCacheBuildIdleRef = useRef<IdleHandle | null>(null)
  const initialOutlineEmitIdleRef = useRef<IdleHandle | null>(null)

  // Block-level incremental serialization cache
  const blockCacheRef = useRef(new BlockCacheManager())

  // Capture nodeViewFactory in a ref so initEditor callback doesn't change
  const nodeViewFactoryRef = useRef(nodeViewFactory)
  nodeViewFactoryRef.current = nodeViewFactory

  const getCurrentMarkdownBody = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return valueRef.current
    return editor.action(getMarkdown())
  }, [])

  const getCurrentMarkdown = useCallback(() => {
    return composeMarkdownWithFrontMatter(frontMatterBlockRef.current, getCurrentMarkdownBody())
  }, [getCurrentMarkdownBody])

  const emitOutlineItems = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const headingType = headingSchema.type(ctx)
      const items = buildHeadingsFromWysiwygDoc({
        doc: view.state.doc,
        headingType,
      })
      const previousItems = lastOutlineItemsRef.current
      if (previousItems.length === items.length) {
        let isSame = true
        for (let index = 0; index < previousItems.length; index += 1) {
          const previous = previousItems[index]
          const next = items[index]
          if (
            previous.id !== next.id ||
            previous.text !== next.text ||
            previous.level !== next.level ||
            previous.source !== next.source ||
            previous.line !== next.line ||
            previous.searchText !== next.searchText ||
            previous.headingIndex !== next.headingIndex
          ) {
            isSame = false
            break
          }
        }
        if (isSame) {
          return
        }
      }
      lastOutlineItemsRef.current = items
      onOutlineItemsChangeRef.current?.(items)
    })
  }, [])

  const scheduleOutlineEmit = useCallback(() => {
    if (outlineEmitFrameRef.current !== null) {
      cancelAnimationFrame(outlineEmitFrameRef.current)
    }
    outlineEmitFrameRef.current = requestAnimationFrame(() => {
      outlineEmitFrameRef.current = null
      emitOutlineItems()
    })
  }, [emitOutlineItems])

  const scheduleInitialCacheBuild = useCallback(() => {
    if (initialCacheBuildIdleRef.current !== null) {
      cancelIdleWork(initialCacheBuildIdleRef.current)
      initialCacheBuildIdleRef.current = null
    }
    initialCacheBuildIdleRef.current = requestIdleWork(() => {
      initialCacheBuildIdleRef.current = null
      const editor = editorRef.current
      if (!editor) return
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const ser = ctx.get(serializerCtx)
        blockCacheRef.current.buildFull(view.state.doc, ser)
      })
    }, 250)
  }, [])

  const scheduleInitialOutlineEmit = useCallback(() => {
    if (initialOutlineEmitIdleRef.current !== null) {
      cancelIdleWork(initialOutlineEmitIdleRef.current)
      initialOutlineEmitIdleRef.current = null
    }
    initialOutlineEmitIdleRef.current = requestIdleWork(() => {
      initialOutlineEmitIdleRef.current = null
      emitOutlineItems()
    }, 250)
  }, [emitOutlineItems])

  const getEffectiveTextColorTarget = useCallback((from: number, to: number): TextColorTarget | null => {
    if (!docKey) return null
    if (from !== to) return createTextColorTarget(docKey, 'wysiwyg', from, to)
    if (isTextColorTargetActive(textColorTargetRef.current, docKey, 'wysiwyg')) {
      return textColorTargetRef.current
    }
    textColorTargetRef.current = null
    return null
  }, [docKey])

  /**
   * Incrementally serialize only the changed blocks, then push through onChange.
   * Falls back to full serialization when the cache is not initialized.
   */
  const incrementalSerializeAndPush = useCallback((
    newDoc: ProseMirrorNode,
    prevDoc: ProseMirrorNode | null,
    serializer: (content: ProseMirrorNode) => string,
  ) => {
    const cache = blockCacheRef.current

    let md: string
    if (!prevDoc || !cache.isInitialized) {
      md = cache.buildFull(newDoc, serializer)
    } else {
      md = cache.incrementalUpdate(prevDoc, newDoc, serializer)
    }

    // Dev-mode verification: compare incremental result against full serialization
    if (import.meta.env.DEV && prevDoc && cache.isInitialized) {
      const fullMd = serializer(newDoc)
      if (md !== fullMd) {
        console.warn(
          '[BlockCache] Incremental/full mismatch detected — rebuilding cache.\n' +
          `  incremental length: ${md.length}, full length: ${fullMd.length}`,
        )
        md = cache.buildFull(newDoc, serializer)
      }
    }

    const nextMarkdown = composeMarkdownWithFrontMatter(frontMatterBlockRef.current, md)
    const currentMarkdown = composeMarkdownWithFrontMatter(frontMatterBlockRef.current, valueRef.current)
    if (nextMarkdown !== currentMarkdown) {
      isInternalUpdate.current = true
      lastSyncedValueRef.current = md
      onChangeRef.current(nextMarkdown)
      queueMicrotask(() => { isInternalUpdate.current = false })
    }
  }, [])

  // Full serialization (used by flushPending, scheduleDelayedSync, and format actions)
  const serializeAndPush = useCallback((requireInteraction = true) => {
    const editor = editorRef.current
    if (!editor) return
    if (requireInteraction && !hasUserInteractedRef.current) return

    // Full serialization via getMarkdown() — also rebuilds block cache
    const md = getCurrentMarkdownBody()

    // Rebuild cache so subsequent incremental updates have a correct baseline
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const ser = ctx.get(serializerCtx)
      blockCacheRef.current.buildFull(view.state.doc, ser)
    })

    const nextMarkdown = composeMarkdownWithFrontMatter(frontMatterBlockRef.current, md)
    const currentMarkdown = composeMarkdownWithFrontMatter(frontMatterBlockRef.current, valueRef.current)
    if (nextMarkdown !== currentMarkdown) {
      isInternalUpdate.current = true
      lastSyncedValueRef.current = md
      onChangeRef.current(nextMarkdown)
      queueMicrotask(() => { isInternalUpdate.current = false })
    }
  }, [getCurrentMarkdownBody])

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
    const scrollContainer = scrollContainerRef.current
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

    if (targetHeadingElement && container && scrollContainer) {
      let didNavigate = false
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        try {
          const targetPos = view.posAtDOM(targetHeadingElement, 0)
          const tr = view.state.tr.setSelection(
            TextSelection.create(view.state.doc, Math.max(1, targetPos + 1)),
          )
          view.dispatch(tr)
          view.focus()
          didNavigate = true
        } catch {
          didNavigate = true
        }
      })

      const scrollContainerRect = scrollContainer.getBoundingClientRect()
      const targetRect = targetHeadingElement.getBoundingClientRect()
      const targetScrollTop =
        scrollContainer.scrollTop + (targetRect.top - scrollContainerRect.top)
      const topOffset = Math.max(24, Math.round(scrollContainer.clientHeight * 0.18))
      scrollContainer.scrollTo({
        top: Math.max(0, targetScrollTop - topOffset),
        behavior: 'auto',
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

        // Capture the serializer for incremental block-level serialization
        const serializer = ctx.get(serializerCtx)

        ctx.get(listenerCtx).updated((_ctx, doc, prevDoc) => {
          if (prevDoc?.eq(doc)) {
            return
          }
          if (!hasUserInteractedRef.current) return

          if (preserveTextColorTargetOnNextDocChangeRef.current) {
            preserveTextColorTargetOnNextDocChangeRef.current = false
          } else {
            textColorTargetRef.current = null
          }

          onDirtyRef.current?.()
          if (idleCallbackRef.current !== null) {
            cancelIdleWork(idleCallbackRef.current)
            idleCallbackRef.current = null
          }
          idleCallbackRef.current = requestIdleWork(() => {
            idleCallbackRef.current = null
            // Use incremental serialization: only re-serialize changed blocks
            incrementalSerializeAndPush(doc, prevDoc, serializer)
          }, 2000)
          scheduleOutlineEmit()
        })
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(listener)
      .use(clipboard)
      .use(indent)
      .use(trailing)
      .use(colorMarkPlugin)
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

    scheduleInitialCacheBuild()
    scheduleInitialOutlineEmit()
  }, [scheduleDelayedSync, scheduleInitialCacheBuild, scheduleInitialOutlineEmit, serializeAndPush, incrementalSerializeAndPush])

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

  const handleFrontMatterChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    frontMatterBlockRef.current = event.target.value.replace(/\r\n/g, '\n')
    onChangeRef.current(composeMarkdownWithFrontMatter(frontMatterBlockRef.current, getCurrentMarkdownBody()))
  }, [getCurrentMarkdownBody])

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
      getCurrentTextColor: () => {
        const editor = editorRef.current
        if (!editor) return null

        let currentColor: string | null = null
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          const selection = view.state.selection as typeof view.state.selection & { main?: { from: number; to: number } }
          const from = selection.main?.from ?? selection.from
          const to = selection.main?.to ?? selection.to
          const target = getEffectiveTextColorTarget(from, to)
          if (!target) return

          const markType = textColorMark.type(ctx)
          let foundText = false
          let mixed = false

          view.state.doc.nodesBetween(target.from, target.to, (node) => {
            if (!node.isText) return
            foundText = true
            const mark = node.marks.find((item) => item.type === markType)
            const color = normalizeTextColor(String(mark?.attrs?.color ?? ''))
            if (currentColor === null) {
              currentColor = color
              return
            }
            if (currentColor !== color) {
              mixed = true
            }
          })

          if (!foundText || mixed) currentColor = null
        })
        return currentColor
      },
      getCurrentTextColorTarget: () => {
        const editor = editorRef.current
        if (!editor) return null

        let target: TextColorTarget | null = null
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          const selection = view.state.selection as typeof view.state.selection & { main?: { from: number; to: number } }
          const from = selection.main?.from ?? selection.from
          const to = selection.main?.to ?? selection.to
          target = getEffectiveTextColorTarget(from, to)
          if (target) {
            textColorTargetRef.current = target
          }
        })
        return target
      },
      applyTextColorToTarget: (color, target) => {
        const editor = editorRef.current
        if (!editor || !isTextColorTargetActive(target, docKey, 'wysiwyg')) return false

        let applied = false
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          const markType = textColorMark.type(ctx)
          let tr = view.state.tr.removeMark(target.from, target.to, markType)
          const normalizedColor = normalizeTextColor(color)
          if (normalizedColor) {
            tr = tr.addMark(target.from, target.to, markType.create({ color: normalizedColor }))
          }
          preserveTextColorTargetOnNextDocChangeRef.current = true
          textColorTargetRef.current = createTextColorTarget(target.docKey, 'wysiwyg', target.from, target.to)
          view.dispatch(tr.scrollIntoView())
          view.focus()
          applied = true
        })
        return applied
      },
      applyTextColor: (color) => {
        const normalizedColor = normalizeTextColor(color)
        if (!normalizedColor) return
        runAction((editor) => {
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx)
            const selection = view.state.selection as typeof view.state.selection & { main?: { from: number; to: number } }
            const from = selection.main?.from ?? selection.from
            const to = selection.main?.to ?? selection.to
            if (from === to) return

            const markType = textColorMark.type(ctx)
            const mark = markType.create({ color: normalizedColor })
            const target = getEffectiveTextColorTarget(from, to)
            if (target) {
              preserveTextColorTargetOnNextDocChangeRef.current = true
              textColorTargetRef.current = target
            }
            const tr = view.state.tr.removeMark(from, to, markType).addMark(from, to, mark).scrollIntoView()
            view.dispatch(tr)
            view.focus()
          })
        })
      },
      clearTextColor: () => {
        runAction((editor) => {
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx)
            const selection = view.state.selection as typeof view.state.selection & { main?: { from: number; to: number } }
            const from = selection.main?.from ?? selection.from
            const to = selection.main?.to ?? selection.to
            if (from === to) return

            const markType = textColorMark.type(ctx)
            const target = getEffectiveTextColorTarget(from, to)
            if (target) {
              preserveTextColorTargetOnNextDocChangeRef.current = true
              textColorTargetRef.current = target
            }
            view.dispatch(view.state.tr.removeMark(from, to, markType).scrollIntoView())
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
      if (skipUnmountFlushRef?.current) {
        skipUnmountFlushRef.current = false
      } else if (hasUserInteractedRef.current) {
        // Only flush on a real unmount. Mode-switch teardown is handled
        // explicitly by the parent and should not re-serialize here.
        flushPending()
      }
      hasUserInteractedRef.current = false
      if (outlineEmitFrameRef.current !== null) {
        cancelAnimationFrame(outlineEmitFrameRef.current)
        outlineEmitFrameRef.current = null
      }
      if (initialCacheBuildIdleRef.current !== null) {
        cancelIdleWork(initialCacheBuildIdleRef.current)
        initialCacheBuildIdleRef.current = null
      }
      if (initialOutlineEmitIdleRef.current !== null) {
        cancelIdleWork(initialOutlineEmitIdleRef.current)
        initialOutlineEmitIdleRef.current = null
      }
      lastOutlineItemsRef.current = []
      onOutlineItemsChangeRef.current?.([])
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
        // Rebuild block cache after external doc replacement
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          const serializer = ctx.get(serializerCtx)
          blockCacheRef.current.buildFull(view.state.doc, serializer)
        })
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

  useEffect(() => {
    const unlisten = onNativePaste((text) => {
      const container = containerRef.current
      const editor = editorRef.current
      const active = typeof document !== 'undefined' ? document.activeElement : null
      if (!container || !editor || !active) return
      if (!container.contains(active)) return

      hasUserInteractedRef.current = true
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const selection = view.state.selection as typeof view.state.selection & { main?: { from: number; to: number } }
        const from = selection.main?.from ?? selection.from
        const to = selection.main?.to ?? selection.to
        view.dispatch(
          view.state.tr.insertText(text, from, to).scrollIntoView(),
        )
        view.focus()
      })
      scheduleDelayedSync()
    })

    return unlisten
  }, [scheduleDelayedSync])

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
      <div ref={scrollContainerRef} className="wysiwyg-scroll">
        {frontMatterBlock ? (
          <section className="wysiwyg-frontmatter-panel">
            <button
              type="button"
              className="wysiwyg-frontmatter-toggle"
              onClick={() => setIsFrontMatterCollapsed((prev) => !prev)}
              aria-expanded={!isFrontMatterCollapsed}
            >
              <span className="wysiwyg-frontmatter-label">YAML Front Matter</span>
              <span className={`wysiwyg-frontmatter-chevron ${isFrontMatterCollapsed ? 'collapsed' : ''}`} aria-hidden="true">▾</span>
            </button>
            {!isFrontMatterCollapsed ? (
              <textarea
                className="wysiwyg-frontmatter-textarea"
                value={frontMatterBlock}
                onChange={handleFrontMatterChange}
                spellCheck={false}
              />
            ) : null}
          </section>
        ) : null}
        <div ref={containerRef} className="wysiwyg-editor" />
      </div>
    </section>
  )
}
