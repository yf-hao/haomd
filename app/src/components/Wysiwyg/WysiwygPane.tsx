import { useEffect, useRef, useCallback, useMemo, useState, type CSSProperties, type ChangeEvent } from 'react'
import { Editor, rootCtx, defaultValueCtx, schemaCtx } from '@milkdown/kit/core'
import { EditorStatus } from '@milkdown/core'
import { commandsCtx, editorViewCtx, prosePluginsCtx, serializerCtx } from '@milkdown/core'
import { commonmark, codeBlockSchema, imageSchema } from '@milkdown/kit/preset/commonmark'
import { codeBlockKeymap } from '@milkdown/preset-commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { indent } from '@milkdown/kit/plugin/indent'
import { trailing } from '@milkdown/kit/plugin/trailing'
import { gapCursorPlugin } from '@milkdown/kit/plugin/cursor'
import { replaceAll, getMarkdown, $view } from '@milkdown/kit/utils'
import { headingSchema, paragraphSchema, strongSchema } from '@milkdown/preset-commonmark'
import { insertTableCommand, strikethroughSchema } from '@milkdown/preset-gfm'
import { setBlockType, toggleMark } from '@milkdown/prose/commands'
import { keymap as createKeymap } from '@milkdown/prose/keymap'
import { TextSelection } from '@milkdown/prose/state'
import type {
  Node as ProseMirrorNode,
  NodeType as ProseMirrorNodeType,
  ResolvedPos,
} from '@milkdown/prose/model'
import type { EditorView } from '@milkdown/prose/view'
import {
  CellSelection,
  addColumnAfter,
  addRowAfter,
  cellAround,
  deleteColumn,
  deleteRow,
  deleteTable,
} from '@milkdown/prose/tables'
import { nord } from '@milkdown/theme-nord'
import { ProsemirrorAdapterProvider, useNodeViewFactory } from '@prosemirror-adapter/react'
import { useThemeContext } from '../../modules/theme/ThemeContext'
import { useI18n } from '../../modules/i18n/I18nContext'
import { createTextColorTarget, isTextColorTargetActive, type TextColorTarget } from '../../modules/editor/textColorTarget'
import type { LayoutType } from '../../hooks/useWorkspaceLayout'
import {
  buildBackgroundImageVars,
  resolveManagedBackgroundImageUrl,
} from '../../modules/theme/backgroundImageRuntime'
import { normalizeTextColor } from '../../modules/markdown/extensions/colorMark'
import { mathPlugin, mathBlockSchema, mathInlineNode } from './plugins/mathPlugin'
import { backgroundColorMark, colorMarkPlugin, textColorMark } from './plugins/colorMark'
import { MathBlockView } from './views/MathBlockView'
import { InlineMathView } from './views/InlineMathView'
import { CodeBlockView } from './views/CodeBlockView'
import { ImageView } from './views/ImageView'
import { normalizeCodeBlockLanguage } from './codeLanguage'
import { BlockCacheManager } from './blockCache'
import { composeMarkdownWithFrontMatter } from '../../modules/markdown/frontMatter'
import { dispatchNativePasteImage, onNativePaste } from '../../modules/platform/clipboardEvents'
import { readClipboardForPaste } from '../../modules/platform/clipboardPasteService'
import { isTauriEnv } from '../../modules/platform/runtime'
import { buildHeadingsFromWysiwygDoc } from '../../modules/outline/wysiwygOutline'
import type { RemoveBlankLinesScope } from '../../modules/document/application/removeBlankLinesService'
import {
  createProseMirrorSearchController,
  createTextareaSearchController,
  type SearchController,
} from '../Editor/searchController'
import { FileContextMenu } from '../FileContextMenu'
import type { OutlineHeading } from '../../modules/outline/outlineSource'
import './WysiwygPane.css'

export interface WysiwygPaneProps {
  value: string
  frontMatterBlock?: string
  onChange: (markdown: string) => void
  filePath?: string | null
  docKey?: string | null
  focusAtEndRequest?: number
  effectiveLayout: LayoutType
  editorZoom?: number
  onSelectionGetterReady?: (getter: (() => string | null) | null) => void
  onFormatActionsReady?: (actions: WysiwygFormatActions | null) => void
  onMarkdownGetterReady?: (getter: (() => string) | null) => void
  onSaveSnapshotReady?: (getter: (() => string) | null) => void
  onBlankLineActionReady?: (action: WysiwygBlankLineAction | null) => void
  onSearchControllerReady?: (controller: SearchController | null) => void
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
  applyBackgroundColor: (color: string) => void
  clearBackgroundColor: () => void
  insertImage: (src: string, alt?: string) => boolean
  insertCodeBlock: () => void
  insertTable: (rows: number, cols: number) => void
}

export type WysiwygBlankLineAction = (
  scope?: RemoveBlankLinesScope,
) => { removedCount: number }

type IdleHandle = number

type TableContextMenuState = {
  x: number
  y: number
  cellPos: number
}

type TableContextMenuAction =
  | 'add-row-after'
  | 'add-column-after'
  | 'delete-row'
  | 'delete-column'
  | 'delete-table'

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

function isTableNode(node: ProseMirrorNode | null): boolean {
  return node?.type.spec.tableRole === 'table' || node?.type.name === 'table'
}

function isEmptyParagraph(node: ProseMirrorNode): boolean {
  if (node.type.name !== 'paragraph') return false
  if (node.content.size === 0) return true

  let isBlank = true
  node.forEach((child) => {
    if (!child.isText || (child.text ?? '').trim() !== '') {
      isBlank = false
    }
  })
  return isBlank
}

function collectTopLevelBlocks(doc: ProseMirrorNode) {
  const blocks: Array<{ node: ProseMirrorNode; pos: number }> = []
  let pos = 0
  for (let index = 0; index < doc.childCount; index += 1) {
    const node = doc.child(index)
    blocks.push({ node, pos })
    pos += node.nodeSize
  }
  return blocks
}

function findBlankLineBlockIndexes(
  doc: ProseMirrorNode,
  scope: RemoveBlankLinesScope,
  codeBlockType: ProseMirrorNodeType | undefined,
): number[] {
  const blocks = collectTopLevelBlocks(doc)
  const indexes: number[] = []

  if (scope === 'all') {
    blocks.forEach(({ node }, index) => {
      if (isEmptyParagraph(node)) indexes.push(index)
    })
  } else {
    let index = 0
    while (index < blocks.length) {
      if (!isEmptyParagraph(blocks[index].node)) {
        index += 1
        continue
      }

      const start = index
      while (index < blocks.length && isEmptyParagraph(blocks[index].node)) {
        index += 1
      }

      const previous = blocks[start - 1]?.node
      const next = blocks[index]?.node
      if (isTableNode(previous) && codeBlockType && next?.type === codeBlockType) {
        for (let gapIndex = start; gapIndex < index; gapIndex += 1) {
          indexes.push(gapIndex)
        }
      }
    }
  }

  // Keep the trailing editable paragraph maintained by Milkdown's trailing plugin.
  const lastBlockIndex = doc.childCount - 1
  if (indexes[indexes.length - 1] === lastBlockIndex) {
    indexes.pop()
  }

  return indexes
}

function insertParagraphBeforeCodeBlock(
  view: EditorView,
  codeBlockType: ProseMirrorNodeType,
): boolean {
  const { state } = view
  const { selection } = state
  if (!selection.empty) return false

  const { $from } = selection
  let codeBlockDepth = -1
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type === codeBlockType) {
      codeBlockDepth = depth
      break
    }
  }

  if (
    codeBlockDepth === -1 ||
    $from.parent !== $from.node(codeBlockDepth) ||
    $from.parentOffset !== 0
  ) {
    return false
  }

  const parentDepth = codeBlockDepth - 1
  const parent = $from.node(parentDepth)
  const codeBlockIndex = $from.index(parentDepth)
  if (codeBlockIndex === 0 || !isTableNode(parent.child(codeBlockIndex - 1))) {
    return false
  }

  const paragraphType = state.schema.nodes.paragraph
  if (!paragraphType || !parent.canReplaceWith(codeBlockIndex, codeBlockIndex, paragraphType)) {
    return false
  }

  const paragraph = paragraphType.createAndFill()
  if (!paragraph) return false

  const insertPos = $from.before(codeBlockDepth)
  let tr = state.tr.insert(insertPos, paragraph)
  tr = tr.setSelection(TextSelection.create(tr.doc, insertPos + 1))
  view.dispatch(tr.scrollIntoView())
  view.focus()
  return true
}

function insertParagraphAfterTable(
  view: EditorView,
  codeBlockType: ProseMirrorNodeType,
): boolean {
  const { state } = view
  const { selection } = state
  if (!selection.empty) return false

  const { $from } = selection
  let tableDepth = -1
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.spec.tableRole === 'table') {
      tableDepth = depth
      break
    }
  }
  if (tableDepth === -1 || !view.endOfTextblock('down')) return false

  const table = $from.node(tableDepth)
  const rowIndex = $from.index(tableDepth)
  if (rowIndex !== table.childCount - 1) return false

  const row = $from.node(tableDepth + 1)
  const cellIndex = $from.index(tableDepth + 1)
  if (cellIndex !== row.childCount - 1) return false

  const cell = $from.node(tableDepth + 2)
  if ($from.index(tableDepth + 2) !== cell.childCount - 1) return false

  const parentDepth = tableDepth - 1
  const parent = $from.node(parentDepth)
  const tableIndex = $from.index(parentDepth)
  if (parent.child(tableIndex + 1)?.type !== codeBlockType) return false

  const paragraphType = state.schema.nodes.paragraph
  if (!paragraphType || !parent.canReplaceWith(tableIndex + 1, tableIndex + 1, paragraphType)) {
    return false
  }

  const paragraph = paragraphType.createAndFill()
  if (!paragraph) return false

  const insertPos = $from.after(tableDepth)
  let tr = state.tr.insert(insertPos, paragraph)
  tr = tr.setSelection(TextSelection.create(tr.doc, insertPos + 1))
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
  focusAtEndRequest,
  onSelectionGetterReady,
  onFormatActionsReady,
  onMarkdownGetterReady,
  onSaveSnapshotReady,
  onBlankLineActionReady,
  onSearchControllerReady,
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
    if (!focusAtEndRequest) return
    const textarea = textareaRef.current
    if (!textarea) return

    const end = textarea.value.length
    textarea.focus()
    textarea.setSelectionRange(end, end)
  }, [focusAtEndRequest])

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
    const textarea = textareaRef.current
    if (!textarea) return
    onSearchControllerReady?.(createTextareaSearchController(textarea))
    return () => onSearchControllerReady?.(null)
  }, [onSearchControllerReady])

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

  useEffect(() => {
    const getter = () => composeMarkdownWithFrontMatter(frontMatterBlock, textareaRef.current?.value ?? value)
    onSaveSnapshotReady?.(getter)
    return () => onSaveSnapshotReady?.(null)
  }, [frontMatterBlock, onSaveSnapshotReady, value])

  useEffect(() => {
    onBlankLineActionReady?.(null)
    return () => onBlankLineActionReady?.(null)
  }, [onBlankLineActionReady])

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
  focusAtEndRequest,
  onSelectionGetterReady,
  onFormatActionsReady,
  onMarkdownGetterReady,
  onSaveSnapshotReady,
  onBlankLineActionReady,
  onSearchControllerReady,
  onOutlineNavigatorReady,
  onOutlineItemsChange,
  skipUnmountFlushRef,
  onFlushReady,
  onDirty,
}: WysiwygPaneProps) {
  const [isFrontMatterCollapsed, setIsFrontMatterCollapsed] = useState(false)
  const [tableContextMenu, setTableContextMenu] = useState<TableContextMenuState | null>(null)
  const { t } = useI18n()
  if (isPlainTextFile(filePath)) {
    return (
      <PlainTextWysiwyg
        value={value}
        frontMatterBlock={frontMatterBlock}
        onChange={onChange}
        filePath={filePath}
        docKey={docKey}
        focusAtEndRequest={focusAtEndRequest}
        effectiveLayout={effectiveLayout}
        editorZoom={editorZoom}
        onSelectionGetterReady={onSelectionGetterReady}
        onMarkdownGetterReady={onMarkdownGetterReady}
        onSaveSnapshotReady={onSaveSnapshotReady}
        onBlankLineActionReady={onBlankLineActionReady}
        onSearchControllerReady={onSearchControllerReady}
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
  const onSaveSnapshotReadyRef = useRef(onSaveSnapshotReady)
  onSaveSnapshotReadyRef.current = onSaveSnapshotReady
  const onBlankLineActionReadyRef = useRef(onBlankLineActionReady)
  onBlankLineActionReadyRef.current = onBlankLineActionReady
  const onSearchControllerReadyRef = useRef(onSearchControllerReady)
  onSearchControllerReadyRef.current = onSearchControllerReady
  const onFormatActionsReadyRef = useRef(onFormatActionsReady)
  onFormatActionsReadyRef.current = onFormatActionsReady
  const onOutlineNavigatorReadyRef = useRef(onOutlineNavigatorReady)
  onOutlineNavigatorReadyRef.current = onOutlineNavigatorReady
  const onOutlineItemsChangeRef = useRef(onOutlineItemsChange)
  onOutlineItemsChangeRef.current = onOutlineItemsChange
  const lastOutlineItemsRef = useRef<OutlineHeading[]>([])

  const isInternalUpdate = useRef(false)
  const textColorTargetRef = useRef<TextColorTarget | null>(null)
  const backgroundColorTargetRef = useRef<TextColorTarget | null>(null)
  const preserveTextColorTargetOnNextDocChangeRef = useRef(false)
  // Track the last value we synced TO the editor (to avoid needless getMarkdown)
  const lastSyncedValueRef = useRef(value)
  const hasUserInteractedRef = useRef(false)
  const idleCallbackRef = useRef<IdleHandle | null>(null)
  const delayedSyncTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const serializationEpochRef = useRef(0)
  const outlineEmitFrameRef = useRef<number | null>(null)
  const initialCacheBuildIdleRef = useRef<IdleHandle | null>(null)
  const initialOutlineEmitIdleRef = useRef<IdleHandle | null>(null)
  const isEditorReadyRef = useRef(false)
  const isMountedRef = useRef(false)
  const [editorReady, setEditorReady] = useState(false)
  const lastFocusAtEndRequestRef = useRef(0)
  const lastValidMarkdownRef = useRef(
    composeMarkdownWithFrontMatter(frontMatterBlock ?? '', value),
  )

  const getReadyEditor = useCallback((expectedEditor?: Editor | null) => {
    const editor = editorRef.current
    if (
      !editor ||
      (expectedEditor !== undefined && editor !== expectedEditor) ||
      !isEditorReadyRef.current ||
      editor.status !== EditorStatus.Created ||
      containerRef.current?.isConnected === false
    ) {
      return null
    }
    return editor
  }, [])

  useEffect(() => {
    const editor = getReadyEditor()
    if (!editor) {
      onSearchControllerReadyRef.current?.(null)
      return
    }

    let view: EditorView | null = null
    editor.action((ctx) => {
      view = ctx.get(editorViewCtx)
    })
    if (!view) {
      onSearchControllerReadyRef.current?.(null)
      return
    }

    onSearchControllerReadyRef.current?.(
      createProseMirrorSearchController(view, () => {
        hasUserInteractedRef.current = true
      }),
    )
    return () => onSearchControllerReadyRef.current?.(null)
  }, [editorReady, getReadyEditor])

  // Block-level incremental serialization cache
  const blockCacheRef = useRef(new BlockCacheManager())

  // Capture nodeViewFactory in a ref so initEditor callback doesn't change
  const nodeViewFactoryRef = useRef(nodeViewFactory)
  nodeViewFactoryRef.current = nodeViewFactory

  const getCurrentMarkdownBody = useCallback(() => {
    const editor = getReadyEditor()
    if (!editor) {
      return lastSyncedValueRef.current
    }
    try {
      return editor.action(getMarkdown())
    } catch (error) {
      console.warn('[WysiwygPane] markdown serialization unavailable', error)
      return lastSyncedValueRef.current
    }
  }, [getReadyEditor])

  const getCurrentMarkdown = useCallback(() => {
    if (!getReadyEditor()) {
      return lastValidMarkdownRef.current
    }
    const markdown = composeMarkdownWithFrontMatter(
      frontMatterBlockRef.current,
      getCurrentMarkdownBody(),
    )
    lastValidMarkdownRef.current = markdown
    return markdown
  }, [getCurrentMarkdownBody, getReadyEditor])

  const emitOutlineItems = useCallback((expectedEditor?: Editor | null) => {
    const editor = getReadyEditor(expectedEditor)
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
  }, [getReadyEditor])

  const scheduleOutlineEmit = useCallback((expectedEditor?: Editor | null) => {
    if (outlineEmitFrameRef.current !== null) {
      cancelAnimationFrame(outlineEmitFrameRef.current)
    }
    const editor = expectedEditor ?? editorRef.current
    outlineEmitFrameRef.current = requestAnimationFrame(() => {
      outlineEmitFrameRef.current = null
      emitOutlineItems(editor)
    })
  }, [emitOutlineItems])

  const scheduleInitialCacheBuild = useCallback(() => {
    if (initialCacheBuildIdleRef.current !== null) {
      cancelIdleWork(initialCacheBuildIdleRef.current)
      initialCacheBuildIdleRef.current = null
    }
    const expectedEditor = editorRef.current
    initialCacheBuildIdleRef.current = requestIdleWork(() => {
      initialCacheBuildIdleRef.current = null
      const editor = getReadyEditor(expectedEditor)
      if (!editor) return
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const ser = ctx.get(serializerCtx)
        blockCacheRef.current.buildFull(view.state.doc, ser)
      })
    }, 250)
  }, [getReadyEditor])

  const scheduleInitialOutlineEmit = useCallback(() => {
    if (initialOutlineEmitIdleRef.current !== null) {
      cancelIdleWork(initialOutlineEmitIdleRef.current)
      initialOutlineEmitIdleRef.current = null
    }
    const expectedEditor = editorRef.current
    initialOutlineEmitIdleRef.current = requestIdleWork(() => {
      initialOutlineEmitIdleRef.current = null
      emitOutlineItems(expectedEditor)
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

  const getEffectiveBackgroundColorTarget = useCallback((from: number, to: number): TextColorTarget | null => {
    if (!docKey) return null
    if (from !== to) return createTextColorTarget(docKey, 'wysiwyg', from, to)
    if (isTextColorTargetActive(backgroundColorTargetRef.current, docKey, 'wysiwyg')) {
      return backgroundColorTargetRef.current
    }
    backgroundColorTargetRef.current = null
    return null
  }, [docKey])

  /**
   * Incrementally serialize only the changed blocks, then push through onChange.
   * Falls back to full serialization when the cache is not initialized.
   */
  const incrementalSerializeAndPush = useCallback((
    newDoc: ProseMirrorNode,
    prevDoc: ProseMirrorNode | null,
    expectedEditor?: Editor | null,
  ) => {
    const editor = getReadyEditor(expectedEditor)
    if (!editor) return

    let md: string
    try {
      md = editor.action((ctx) => {
        const serializer = ctx.get(serializerCtx)
        const cache = blockCacheRef.current

        let nextMarkdown: string
        if (!prevDoc || !cache.isInitialized) {
          nextMarkdown = cache.buildFull(newDoc, serializer)
        } else {
          nextMarkdown = cache.incrementalUpdate(prevDoc, newDoc, serializer)
        }

        // Dev-mode verification: compare incremental result against full serialization
        if (import.meta.env.DEV && prevDoc && cache.isInitialized) {
          const fullMd = serializer(newDoc)
          if (nextMarkdown !== fullMd) {
            console.warn(
              '[BlockCache] Incremental/full mismatch detected — rebuilding cache.\n' +
              `  incremental length: ${nextMarkdown.length}, full length: ${fullMd.length}`,
            )
            nextMarkdown = cache.buildFull(newDoc, serializer)
          }
        }

        return nextMarkdown
      })
    } catch (error) {
      console.warn('[WysiwygPane] incremental serialization unavailable', error)
      return
    }

    if (getReadyEditor(editor) !== editor) return

    const nextMarkdown = composeMarkdownWithFrontMatter(frontMatterBlockRef.current, md)
    if (md === lastSyncedValueRef.current) return

    lastValidMarkdownRef.current = nextMarkdown
    isInternalUpdate.current = true
    lastSyncedValueRef.current = md
    onChangeRef.current(nextMarkdown)
    queueMicrotask(() => { isInternalUpdate.current = false })
  }, [getReadyEditor])

  // Full serialization (used by flushPending, scheduleDelayedSync, and format actions)
  const serializeAndPush = useCallback((
    requireInteraction = true,
    expectedEditor?: Editor | null,
  ) => {
    const editor = getReadyEditor(expectedEditor)
    if (!editor) return
    if (requireInteraction && !hasUserInteractedRef.current) return

    // Full serialization via getMarkdown() — also rebuilds block cache
    const md = getCurrentMarkdownBody()

    // Rebuild cache so subsequent incremental updates have a correct baseline
    if (getReadyEditor(editor) !== editor) return
    try {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const ser = ctx.get(serializerCtx)
        blockCacheRef.current.buildFull(view.state.doc, ser)
      })
    } catch (error) {
      console.warn('[WysiwygPane] cache rebuild unavailable', error)
      return
    }
    const nextMarkdown = composeMarkdownWithFrontMatter(frontMatterBlockRef.current, md)
    if (md === lastSyncedValueRef.current) return

    lastValidMarkdownRef.current = nextMarkdown
    isInternalUpdate.current = true
    lastSyncedValueRef.current = md
    onChangeRef.current(nextMarkdown)
    queueMicrotask(() => { isInternalUpdate.current = false })
  }, [getCurrentMarkdownBody, getReadyEditor])

  const flushPending = useCallback(() => {
    serializationEpochRef.current += 1
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
    const epoch = ++serializationEpochRef.current
    const expectedEditor = getReadyEditor()
    if (delayedSyncTimerRef.current !== null) {
      window.clearTimeout(delayedSyncTimerRef.current)
      delayedSyncTimerRef.current = null
    }
    if (idleCallbackRef.current !== null) {
      cancelIdleWork(idleCallbackRef.current)
      idleCallbackRef.current = null
    }
    if (!expectedEditor) return
    delayedSyncTimerRef.current = window.setTimeout(() => {
      delayedSyncTimerRef.current = null
      if (epoch !== serializationEpochRef.current) return
      serializeAndPush(true, expectedEditor)
    }, delayMs)
  }, [getReadyEditor, serializeAndPush])

  const removeBlankLineBlocks = useCallback<WysiwygBlankLineAction>((scope = 'all') => {
    const editor = getReadyEditor()
    if (!editor) return { removedCount: 0 }

    let removedCount = 0
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const codeBlockType = ctx.get(schemaCtx).nodes[codeBlockSchema.id]
      const blocks = collectTopLevelBlocks(view.state.doc)
      const indexes = findBlankLineBlockIndexes(view.state.doc, scope, codeBlockType)
      if (indexes.length === 0) return

      const tr = view.state.tr
      for (let index = indexes.length - 1; index >= 0; index -= 1) {
        const block = blocks[indexes[index]]
        tr.delete(block.pos, block.pos + block.node.nodeSize)
      }

      tr.setMeta('uiEvent', 'input')
      view.dispatch(tr.scrollIntoView())
      removedCount = indexes.length
    })

    if (removedCount > 0) {
      hasUserInteractedRef.current = true
      flushPending()
      scheduleOutlineEmit(editor)
    }

    return { removedCount }
  }, [flushPending, getReadyEditor, scheduleOutlineEmit])

  const getSaveSnapshot = useCallback(() => {
    serializationEpochRef.current += 1
    if (idleCallbackRef.current !== null) {
      cancelIdleWork(idleCallbackRef.current)
      idleCallbackRef.current = null
    }
    if (delayedSyncTimerRef.current !== null) {
      window.clearTimeout(delayedSyncTimerRef.current)
      delayedSyncTimerRef.current = null
    }
    return getCurrentMarkdown()
  }, [getCurrentMarkdown])

  const runAction = useCallback((runner: (editor: Editor) => void) => {
    const editor = getReadyEditor()
    if (!editor) return

    hasUserInteractedRef.current = true
    runner(editor)
    if (getReadyEditor() === editor) {
      scheduleDelayedSync()
    }
  }, [getReadyEditor, scheduleDelayedSync])

  const handleTableContextMenu = useCallback((event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const cell = target.closest('td, th')
    const container = containerRef.current
    if (!cell || !container || !container.contains(cell)) return

    const editor = getReadyEditor()
    if (!editor) return

    const cellPos = editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      let $cell: ResolvedPos | null = null
      try {
        $cell = cellAround(view.state.doc.resolve(view.posAtDOM(cell, 0)))
      } catch (error) {
        console.warn('[WysiwygPane] failed to resolve table cell from context menu:', error)
      }
      if (!$cell) {
        const coords = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        })
        if (coords) {
          $cell = cellAround(view.state.doc.resolve(coords.pos))
        }
      }
      if (!$cell) return null

      view.dispatch(view.state.tr.setSelection(new CellSelection($cell)))
      view.focus()
      return $cell.pos
    })

    if (cellPos === null) return

    event.preventDefault()
    event.stopPropagation()
    setTableContextMenu({
      x: event.clientX,
      y: event.clientY,
      cellPos,
    })
  }, [getReadyEditor])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    container.addEventListener('contextmenu', handleTableContextMenu, true)
    return () => {
      container.removeEventListener('contextmenu', handleTableContextMenu, true)
    }
  }, [handleTableContextMenu])

  const runTableContextAction = useCallback((action: TableContextMenuAction) => {
    const context = tableContextMenu
    if (!context) return

    setTableContextMenu(null)
    runAction((editor) => {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const safePos = Math.min(Math.max(0, context.cellPos), view.state.doc.content.size)
        view.dispatch(
          view.state.tr.setSelection(CellSelection.create(view.state.doc, safePos)),
        )
        let changed = false
        if (action === 'add-row-after') {
          changed = addRowAfter(view.state, view.dispatch)
        } else if (action === 'add-column-after') {
          changed = addColumnAfter(view.state, view.dispatch)
        } else if (action === 'delete-row') {
          changed = deleteRow(view.state, view.dispatch)
        } else if (action === 'delete-column') {
          changed = deleteColumn(view.state, view.dispatch)
        } else {
          changed = deleteTable(view.state, view.dispatch)
        }
        if (!changed) {
          console.warn('[WysiwygPane] table context menu action did not change the document:', action)
        }
        view.focus()
      })
    })
  }, [runAction, tableContextMenu])

  const insertCodeBlockWithInheritedLanguage = useCallback((editor: Editor) => {
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const codeBlockType = codeBlockSchema.type(ctx)
      insertInheritedCodeBlock(view, codeBlockType)
    })
  }, [])

  const navigateToHeadingByIndex = useCallback((target: { headingIndex: number; text: string; level: 1 | 2 | 3 | 4 | 5 | 6 }) => {
    const editor = getReadyEditor()
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
  }, [getReadyEditor])

  const initEditor = useCallback(async () => {
    if (!containerRef.current) return
    const runId = ++initRunIdRef.current
    isEditorReadyRef.current = false

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
            ArrowDown: (_state, _dispatch, view) => {
              if (!view) return false
              const codeBlockType = ctx.get(schemaCtx).nodes[codeBlockSchema.id]
              if (!codeBlockType) return false
              const inserted = insertParagraphAfterTable(view, codeBlockType)
              if (inserted) {
                hasUserInteractedRef.current = true
                scheduleDelayedSync()
              }
              return inserted
            },
            Enter: (_state, _dispatch, view) => {
              if (!view) return false
              const codeBlockType = ctx.get(schemaCtx).nodes[codeBlockSchema.id]
              if (!codeBlockType) return false
              const inserted = insertParagraphBeforeCodeBlock(view, codeBlockType)
              if (inserted) {
                hasUserInteractedRef.current = true
                scheduleDelayedSync()
              }
              return inserted
            },
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

        ctx.get(listenerCtx).updated((_ctx, doc, prevDoc) => {
          if (prevDoc?.eq(doc)) {
            return
          }
          if (!hasUserInteractedRef.current) return

          if (preserveTextColorTargetOnNextDocChangeRef.current) {
            preserveTextColorTargetOnNextDocChangeRef.current = false
          } else {
            textColorTargetRef.current = null
            backgroundColorTargetRef.current = null
          }

          onDirtyRef.current?.()
          if (idleCallbackRef.current !== null) {
            cancelIdleWork(idleCallbackRef.current)
            idleCallbackRef.current = null
          }
          const epoch = ++serializationEpochRef.current
          const ownerEditor = editorRef.current
          if (!ownerEditor) return
          idleCallbackRef.current = requestIdleWork(() => {
            idleCallbackRef.current = null
            if (epoch !== serializationEpochRef.current) return
            // Use incremental serialization: only re-serialize changed blocks
            incrementalSerializeAndPush(doc, prevDoc, ownerEditor)
          }, 2000)
          scheduleOutlineEmit(ownerEditor)
        })
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(listener)
      .use(clipboard)
      .use(indent)
      .use(trailing)
      // Allow a real selection between adjacent block nodes, such as a table and code block.
      .use(gapCursorPlugin)
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

    if (!isMountedRef.current || runId !== initRunIdRef.current) {
      editor.destroy()
      return
    }

    isEditorReadyRef.current = false
    const previousEditor = editorRef.current
    editorRef.current = null
    if (previousEditor && previousEditor.status !== EditorStatus.Destroyed) {
      previousEditor.destroy()
    }
    editorRef.current = editor
    isEditorReadyRef.current = true
    if (!isMountedRef.current || runId !== initRunIdRef.current) {
      editor.destroy()
      editorRef.current = null
      return
    }
    setEditorReady(true)

    scheduleInitialCacheBuild()
    scheduleInitialOutlineEmit()
  }, [incrementalSerializeAndPush, scheduleDelayedSync, scheduleInitialCacheBuild, scheduleInitialOutlineEmit, scheduleOutlineEmit, serializeAndPush])

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
    onSaveSnapshotReadyRef.current?.(getSaveSnapshot)
    return () => onSaveSnapshotReadyRef.current?.(null)
  }, [getSaveSnapshot])

  useEffect(() => {
    onBlankLineActionReadyRef.current?.(removeBlankLineBlocks)
    return () => onBlankLineActionReadyRef.current?.(null)
  }, [removeBlankLineBlocks])

  const handleFrontMatterChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    frontMatterBlockRef.current = event.target.value.replace(/\r\n/g, '\n')
    const markdown = composeMarkdownWithFrontMatter(
      frontMatterBlockRef.current,
      getCurrentMarkdownBody(),
    )
    lastValidMarkdownRef.current = markdown
    onChangeRef.current(markdown)
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
        const editor = getReadyEditor()
        if (!editor) return null

        let currentColor: string | null = null
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          const selection = view.state.selection as typeof view.state.selection & { main?: { from: number; to: number } }
          const from = selection.main?.from ?? selection.from
          const to = selection.main?.to ?? selection.to
          if (from === to) return

          const markType = textColorMark.type(ctx)
          let foundText = false
          let mixed = false

          view.state.doc.nodesBetween(from, to, (node) => {
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
        const editor = getReadyEditor()
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
        const editor = getReadyEditor()
        if (!editor || !isTextColorTargetActive(target, docKey, 'wysiwyg')) return false

        let applied = false
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          const markType = textColorMark.type(ctx)
          const normalizedColor = normalizeTextColor(color)
          let foundText = false
          let needsChange = false
          view.state.doc.nodesBetween(target.from, target.to, (node) => {
            if (!node.isText) return
            foundText = true
            const currentColor = normalizeTextColor(
              String(node.marks.find((mark) => mark.type === markType)?.attrs?.color ?? ''),
            )
            if (currentColor !== normalizedColor) {
              needsChange = true
            }
          })
          if (!foundText) return
          if (!needsChange) {
            applied = true
            return
          }

          let tr = view.state.tr.removeMark(target.from, target.to, markType)
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
            let foundText = false
            let needsChange = false
            view.state.doc.nodesBetween(from, to, (node) => {
              if (!node.isText) return
              foundText = true
              const currentColor = normalizeTextColor(
                String(node.marks.find((mark) => mark.type === markType)?.attrs?.color ?? ''),
              )
              if (currentColor !== normalizedColor) {
                needsChange = true
              }
            })
            if (!foundText || !needsChange) return

            const mark = markType.create({ color: normalizedColor })
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
            let foundText = false
            let hasColor = false
            view.state.doc.nodesBetween(from, to, (node) => {
              if (!node.isText) return
              foundText = true
              if (node.marks.some((mark) => mark.type === markType)) {
                hasColor = true
              }
            })
            if (!foundText || !hasColor) return

            view.dispatch(view.state.tr.removeMark(from, to, markType).scrollIntoView())
            view.focus()
          })
        })
      },
      applyBackgroundColor: (color) => {
        const normalizedColor = normalizeTextColor(color)
        if (!normalizedColor) return
        runAction((editor) => {
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx)
            const selection = view.state.selection as typeof view.state.selection & { main?: { from: number; to: number } }
            const from = selection.main?.from ?? selection.from
            const to = selection.main?.to ?? selection.to
            const target = getEffectiveBackgroundColorTarget(from, to)
            if (!target) return

            const markType = backgroundColorMark.type(ctx)
            let foundText = false
            let needsChange = false
            view.state.doc.nodesBetween(target.from, target.to, (node) => {
              if (!node.isText) return
              foundText = true
              const currentColor = normalizeTextColor(
                String(node.marks.find((mark) => mark.type === markType)?.attrs?.color ?? ''),
              )
              if (currentColor !== normalizedColor) needsChange = true
            })
            if (!foundText || !needsChange) return

            const mark = markType.create({ color: normalizedColor })
            backgroundColorTargetRef.current = target
            preserveTextColorTargetOnNextDocChangeRef.current = true
            view.dispatch(view.state.tr.removeMark(target.from, target.to, markType).addMark(target.from, target.to, mark).scrollIntoView())
            view.focus()
          })
        })
      },
      clearBackgroundColor: () => {
        runAction((editor) => {
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx)
            const selection = view.state.selection as typeof view.state.selection & { main?: { from: number; to: number } }
            const from = selection.main?.from ?? selection.from
            const to = selection.main?.to ?? selection.to
            const markType = backgroundColorMark.type(ctx)
            const target = getEffectiveBackgroundColorTarget(from, to)
            if (!target) return
            let hasBackgroundColor = false
            view.state.doc.nodesBetween(target.from, target.to, (node) => {
              if (node.isText && node.marks.some((mark) => mark.type === markType)) {
                hasBackgroundColor = true
              }
            })
            if (!hasBackgroundColor) return

            backgroundColorTargetRef.current = target
            preserveTextColorTargetOnNextDocChangeRef.current = true
            view.dispatch(view.state.tr.removeMark(target.from, target.to, markType).scrollIntoView())
            view.focus()
          })
        })
      },
      insertImage: (src, alt = '图片') => {
        if (!src) return false

        let inserted = false
        runAction((editor) => {
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx)
            const imageType = imageSchema.type(ctx)
            const image = imageType.create({ src, alt, title: '' })
            const tr = view.state.tr.replaceSelectionWith(image, false).scrollIntoView()
            if (!tr.docChanged) return
            view.dispatch(tr)
            view.focus()
            inserted = true
          })
        })
        return inserted
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
  }, [getEffectiveBackgroundColorTarget, getReadyEditor, insertCodeBlockWithInheritedLanguage, runAction])

  useEffect(() => {
    isMountedRef.current = true
    void initEditor().catch((error) => {
      if (isMountedRef.current) {
        console.error('[WysiwygPane] editor initialization failed', error)
      }
    })
    return () => {
      isMountedRef.current = false
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
      onSearchControllerReadyRef.current?.(null)
      onFormatActionsReadyRef.current?.(null)
      onOutlineNavigatorReadyRef.current?.(null)
      const editor = editorRef.current
      isEditorReadyRef.current = false
      if (isMountedRef.current) {
        setEditorReady(false)
      }
      editorRef.current = null
      if (editor && editor.status !== EditorStatus.Destroyed) {
        editor.destroy()
      }
    }
  }, [flushPending, initEditor])

  // Sync external value changes (e.g. tab switch, file reload)
  useEffect(() => {
    const editor = getReadyEditor()
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
  }, [editorReady, getReadyEditor, value])

  useEffect(() => {
    if (!focusAtEndRequest || focusAtEndRequest === lastFocusAtEndRequestRef.current) return

    const editor = getReadyEditor()
    if (!editor) return

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const end = Math.max(1, view.state.doc.content.size)
      view.dispatch(
        view.state.tr
          .setSelection(TextSelection.create(view.state.doc, end))
          .scrollIntoView(),
      )
      view.focus()
    })
    lastFocusAtEndRequestRef.current = focusAtEndRequest
  }, [editorReady, focusAtEndRequest, getReadyEditor])

  const handleDoubleClickAfterDocument = useCallback((event: React.MouseEvent<HTMLElement>) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (
      target.closest('.wysiwyg-frontmatter-panel') ||
      target.closest('.ProseMirror') ||
      target.closest('.wysiwyg-plain-textarea') ||
      !target.closest('.wysiwyg-scroll')
    ) {
      return
    }

    const editor = getReadyEditor()
    if (!editor) return

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const end = Math.max(1, view.state.doc.content.size)
      view.dispatch(
        view.state.tr
          .setSelection(TextSelection.create(view.state.doc, end))
          .scrollIntoView(),
      )
      view.focus()
    })
  }, [getReadyEditor])

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

    const handlePaste = (event: ClipboardEvent) => {
      markUserInteracted()
      if (!isTauriEnv()) return

      const clipboardData = event.clipboardData
      const hasImage = (() => {
        if (!clipboardData) return false
        // Standard file-based paste (Windows Snipping Tool, browser copy-image, etc.)
        if (
          Array.from(clipboardData.items).some(
            (item) => item.kind === 'file' && item.type.startsWith('image/'),
          )
        ) {
          return true
        }
        // Some screenshot tools (Snipaste, PixPin, QQ, WeChat) write HTML with base64 image
        const html = clipboardData.getData('text/html')
        if (html.includes('data:image/')) return true
        return false
      })()
      if (!hasImage) return

      // Prevent WebView from inserting a transient blob URL before the native
      // clipboard reader saves the image and inserts its path.
      event.preventDefault()
      event.stopPropagation()

      void readClipboardForPaste()
        .then((content) => {
          if (content.kind === 'image') {
            return dispatchNativePasteImage()
          }
          return undefined
        })
        .catch((error) => {
          console.error('[WysiwygPane] native image paste failed:', error)
        })
    }

    container.addEventListener('beforeinput', markUserInteracted)
    container.addEventListener('keydown', handleKeydown, true)
    container.addEventListener('paste', handlePaste, true)
    container.addEventListener('drop', markUserInteracted)
    container.addEventListener('compositionstart', markUserInteracted)

    return () => {
      container.removeEventListener('beforeinput', markUserInteracted)
      container.removeEventListener('keydown', handleKeydown, true)
      container.removeEventListener('paste', handlePaste, true)
      container.removeEventListener('drop', markUserInteracted)
      container.removeEventListener('compositionstart', markUserInteracted)
    }
  }, [flushPending, getReadyEditor, insertCodeBlockWithInheritedLanguage, scheduleDelayedSync])

  useEffect(() => {
    const unlisten = onNativePaste((text) => {
      const container = containerRef.current
      const editor = getReadyEditor()
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
  }, [getReadyEditor, scheduleDelayedSync])

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
      onDoubleClick={handleDoubleClickAfterDocument}
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
      {tableContextMenu ? (
        <FileContextMenu
          x={tableContextMenu.x}
          y={tableContextMenu.y}
          items={[
            {
              id: 'add-row-after',
              label: t('workspace.tableAddRowAfter'),
              onClick: () => runTableContextAction('add-row-after'),
            },
            {
              id: 'add-column-after',
              label: t('workspace.tableAddColumnAfter'),
              onClick: () => runTableContextAction('add-column-after'),
            },
            {
              id: 'delete-row',
              label: t('workspace.tableDeleteRow'),
              onClick: () => runTableContextAction('delete-row'),
            },
            {
              id: 'delete-column',
              label: t('workspace.tableDeleteColumn'),
              onClick: () => runTableContextAction('delete-column'),
            },
            {
              id: 'delete-table',
              label: t('workspace.tableDelete'),
              onClick: () => runTableContextAction('delete-table'),
            },
          ]}
          onRequestClose={() => setTableContextMenu(null)}
        />
      ) : null}
    </section>
  )
}
