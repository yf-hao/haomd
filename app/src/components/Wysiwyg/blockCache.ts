/**
 * Block-level incremental serialization for the WYSIWYG editor.
 *
 * Instead of serializing the entire ProseMirror document on every change,
 * this module caches per-block markdown and only re-serializes blocks that
 * actually changed (detected via ProseMirror's node.eq()).
 *
 * Typical edits touch 1-2 blocks, yielding 15-50x speedup on large documents.
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

export class BlockCacheManager {
  private entries: BlockCacheEntry[] = []
  private docNodeType: ProseMirrorNode['type'] | null = null

  /**
   * Build the full cache from scratch.
   * Called on initial load, after replaceAll, or when incremental update
   * determines a full rebuild is needed.
   */
  buildFull(doc: ProseMirrorNode, serializer: Serializer): string {
    this.docNodeType = doc.type
    this.entries = []

    for (let i = 0; i < doc.childCount; i++) {
      const block = doc.child(i)
      this.entries.push({
        node: block,
        markdown: this.serializeBlock(block, serializer),
      })
    }

    return this.joinBlocks()
  }

  /**
   * Incrementally update the cache based on changes between oldDoc and newDoc.
   * Returns the full markdown string.
   *
   * Falls back to full rebuild if the diff is too large (> 30% of blocks changed
   * or structural change is ambiguous), or if the cache is stale (doesn't match oldDoc).
   */
  incrementalUpdate(
    oldDoc: ProseMirrorNode,
    newDoc: ProseMirrorNode,
    serializer: Serializer,
  ): string {
    this.docNodeType = newDoc.type

    // If cache is empty or corrupted, do a full build
    if (this.entries.length === 0 || this.entries.length !== oldDoc.childCount) {
      return this.buildFull(newDoc, serializer)
    }

    // Verify cache actually represents oldDoc (guards against stale cache when
    // rapid edits cancel pending idle callbacks — each new callback receives a
    // different oldDoc but the cache was never updated for the skipped version)
    if (!this.cacheMatchesDoc(oldDoc)) {
      return this.buildFull(newDoc, serializer)
    }

    const diff = diffTopLevelBlocks(oldDoc, newDoc)

    // Fallback: if too many blocks changed, or the diff is complex (insertions/deletions),
    // a full rebuild is safer and not much slower
    const totalBlocks = Math.max(oldDoc.childCount, newDoc.childCount)
    const changedCount = diff.changed.length + diff.inserted.length + diff.deleted.length
    if (changedCount > totalBlocks * 0.3 || diff.inserted.length > 0 || diff.deleted.length > 0) {
      return this.buildFull(newDoc, serializer)
    }

    // Fast path: only re-serialize changed blocks
    for (const idx of diff.changed) {
      const block = newDoc.child(idx)
      this.entries[idx] = {
        node: block,
        markdown: this.serializeBlock(block, serializer),
      }
    }

    return this.joinBlocks()
  }

  /** Get the cached full markdown without re-serializing */
  getFullMarkdown(): string {
    return this.joinBlocks()
  }

  /** Check if cache is initialized */
  get isInitialized(): boolean {
    return this.entries.length > 0
  }

  /** Number of cached blocks */
  get blockCount(): number {
    return this.entries.length
  }

  /**
   * Verify that cached node references match the given doc's top-level blocks.
   * Uses ProseMirror node identity (===) for a fast O(n) check.
   * If any cached node doesn't match, the cache is stale.
   */
  private cacheMatchesDoc(doc: ProseMirrorNode): boolean {
    if (this.entries.length !== doc.childCount) return false
    for (let i = 0; i < doc.childCount; i++) {
      if (this.entries[i].node !== doc.child(i)) return false
    }
    return true
  }

  /**
   * Serialize a single block by wrapping it in a temporary doc node.
   * This mirrors Milkdown's getMarkdown(range) approach.
   */
  private serializeBlock(block: ProseMirrorNode, serializer: Serializer): string {
    if (!this.docNodeType) return ''
    const miniDoc = this.docNodeType.createAndFill(null, Fragment.from(block))
    if (!miniDoc) return ''
    // serializer returns the full markdown of the mini-doc;
    // trim trailing whitespace/newlines that remark-stringify may add
    return serializer(miniDoc).replace(/\n+$/, '')
  }

  /** Join all cached block markdowns with double-newline separators */
  private joinBlocks(): string {
    if (this.entries.length === 0) return ''
    return this.entries.map((e) => e.markdown).join('\n\n') + '\n'
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
