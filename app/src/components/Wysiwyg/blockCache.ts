/**
 * Block-level incremental serialization for the WYSIWYG editor.
 *
 * Instead of serializing the entire ProseMirror document on every change,
 * this module caches per-block markdown and only re-serializes blocks that
 * actually changed (detected via ProseMirror's node.eq()).
 *
 * Reuses immutable blocks across edits, insertions and deletions.
 */
import type { Node as ProseMirrorNode } from '@milkdown/prose/model'
import { Fragment } from '@milkdown/prose/model'

// Serializer function type matches Milkdown's serializerCtx value
type Serializer = (content: ProseMirrorNode) => string

/* ---------- Block cache entry ---------- */

export interface BlockCacheEntry {
  /** ProseMirror node reference — used for eq() comparison */
  node: ProseMirrorNode
  /** Serialized markdown for this block */
  markdown: string
}

/* ---------- Block cache manager ---------- */

// Unknown/container blocks use the document serializer so list separators,
// reference definitions and future extensions retain their global semantics.
const independentBlocks = new Set(['paragraph', 'heading', 'code_block', 'math_display', 'hr'])

export class BlockCacheManager {
  private entries: BlockCacheEntry[] = []
  private doc: ProseMirrorNode | null = null
  private serializer: Serializer | null = null
  private markdown = ''
  private incremental = false

  buildFull(doc: ProseMirrorNode, serializer: Serializer): string {
    this.doc = doc
    this.serializer = serializer
    this.markdown = serializer(doc)
    this.entries = []
    let independent = true
    doc.forEach(block => { if (!independentBlocks.has(block.type.name)) independent = false })
    if (independent) {
      doc.forEach(block => this.entries.push({ node: block, markdown: this.serializeBlock(block, doc, serializer) }))
    }
    // Verify the serializer's separator/trailing-newline convention once at the
    // cache boundary, never on every keystroke. Unsupported output uses full serialization.
    this.incremental = independent && this.joinBlocks() === this.markdown
    return this.markdown
  }

  incrementalUpdate(
    _oldDoc: ProseMirrorNode,
    newDoc: ProseMirrorNode,
    serializer: Serializer,
  ): string {
    if (this.doc === newDoc && this.serializer === serializer) return this.markdown
    if (!this.incremental || !this.doc?.sameMarkup(newDoc) || this.serializer !== serializer) {
      return this.buildFull(newDoc, serializer)
    }
    // Compare to the actual cache baseline, even when intermediate jobs were skipped.
    const cached = new Map(this.entries.map(entry => [entry.node, entry]))
    const entries: BlockCacheEntry[] = []
    let independent = true
    newDoc.forEach(block => {
      if (!independent || !independentBlocks.has(block.type.name)) { independent = false; return }
      const entry = cached.get(block) ?? { node: block, markdown: this.serializeBlock(block, newDoc, serializer) }
      if (!entry.markdown.trim()) independent = false
      entries.push(entry)
    })
    if (!independent) return this.buildFull(newDoc, serializer)
    this.entries = entries
    this.doc = newDoc
    this.markdown = this.joinBlocks()
    return this.markdown
  }

  getFullMarkdown(): string { return this.markdown }
  get isInitialized(): boolean { return this.doc !== null }
  get blockCount(): number { return this.doc?.childCount ?? 0 }

  private serializeBlock(block: ProseMirrorNode, doc: ProseMirrorNode, serializer: Serializer): string {
    const miniDoc = doc.type.createAndFill(doc.attrs, Fragment.from(block))
    if (!miniDoc) return ''
    return serializer(miniDoc).replace(/\n+$/, '')
  }

  private joinBlocks(): string {
    return this.entries.length === 0 ? '' : this.entries.map(entry => entry.markdown).join('\n\n') + '\n'
  }
}

/* ---------- Block diff algorithm ---------- */

export interface BlockDiff {
  /** Indices of blocks that exist in both docs but have different content */
  changed: number[]
  /** Indices (in newDoc) of newly inserted blocks */
  inserted: number[]
  /** Indices (in oldDoc) of deleted blocks */
  deleted: number[]
}

/**
 * Compare top-level blocks between two document versions.
 *
 * Uses a simple positional comparison: block i in oldDoc vs block i in newDoc.
 * This is fast and correct for the common case (editing within existing blocks).
 *
 * For insertions/deletions (block count changes), we report them but the caller
 * should fall back to full serialization for correctness.
 */
export function diffTopLevelBlocks(
  oldDoc: ProseMirrorNode,
  newDoc: ProseMirrorNode,
): BlockDiff {
  const changed: number[] = []
  const inserted: number[] = []
  const deleted: number[] = []

  const minCount = Math.min(oldDoc.childCount, newDoc.childCount)

  // Compare blocks at matching positions
  for (let i = 0; i < minCount; i++) {
    if (!oldDoc.child(i).eq(newDoc.child(i))) {
      changed.push(i)
    }
  }

  // Extra blocks in newDoc = inserted
  for (let i = minCount; i < newDoc.childCount; i++) {
    inserted.push(i)
  }

  // Extra blocks in oldDoc = deleted
  for (let i = minCount; i < oldDoc.childCount; i++) {
    deleted.push(i)
  }

  return { changed, inserted, deleted }
}
