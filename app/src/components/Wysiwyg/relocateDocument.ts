import { EditorState, Selection } from '@milkdown/prose/state'
import { undo, redo, closeHistory } from '@milkdown/prose/history'
import { Fragment, type Node } from '@milkdown/prose/model'
import type { EditorView } from '@milkdown/prose/view'
import { relocateMarkdown, relocateUrl, type FileRelocation } from '../../modules/markdown/references/relocationPlanner'
import { relocateSrcset } from '../../modules/markdown/references/relocateSrcset'

function relocateNode(node: Node, path: string, move: FileRelocation): Node {
  const attrs = { ...node.attrs }
  for (const key of ['src', 'href', 'poster']) {
    if (typeof attrs[key] === 'string') attrs[key] = relocateUrl(attrs[key], path, move)
  }
  if (typeof attrs.srcset === 'string') attrs.srcset = relocateSrcset(attrs.srcset, url => relocateUrl(url, path, move))
  if (node.type.name === 'html' && typeof attrs.value === 'string') attrs.value = relocateMarkdown(attrs.value, path, move)
  const marks = node.marks.map(mark => {
    const attrs = { ...mark.attrs }
    if (typeof attrs.href === 'string') attrs.href = relocateUrl(attrs.href, path, move)
    return mark.type.create(attrs)
  })
  if (node.isText) return node.mark(marks)
  const children: Node[] = []
  node.forEach(child => children.push(relocateNode(child, path, move)))
  return node.type.create(attrs, Fragment.fromArray(children), marks)
}

/** Replay transformed snapshots into the existing plugin set, then retain the view. */
export function relocateProseMirrorDocument(view: EditorView, path: string, move: FileRelocation): void {
  const original = view.state
  const collect = (command: typeof undo) => {
    let state = original
    const snapshots: EditorState[] = []
    while (command(state, transaction => { state = state.apply(transaction) })) snapshots.push(state)
    return snapshots
  }
  const past = collect(undo).reverse()
  const future = collect(redo)
  const states = [...past, original, ...future].map(state => ({ state, doc: relocateNode(state.doc, path, move) }))
  if (states.every(({ state, doc }) => state.doc.eq(doc))) return
  const first = states[0]
  let rebuilt = EditorState.create({ schema: original.schema, plugins: original.plugins,
    doc: first.doc, selection: Selection.fromJSON(first.doc, first.state.selection.toJSON()) })
  let futureEvents = 0
  for (let index = 1; index < states.length; index++) {
    const { state: snapshot, doc: document } = states[index]
    const from = rebuilt.doc.content.findDiffStart(document.content)
    let transaction = closeHistory(rebuilt.tr)
    if (from !== null) {
      if (index > past.length) futureEvents++
      const end = rebuilt.doc.content.findDiffEnd(document.content)!
      const overlap = from - Math.min(end.a, end.b)
      transaction = transaction.replace(from, end.a + Math.max(0, overlap), document.slice(from, end.b + Math.max(0, overlap)))
    }
    transaction.setSelection(Selection.fromJSON(transaction.doc, snapshot.selection.toJSON()))
    rebuilt = rebuilt.apply(transaction)
  }
  for (let i = 0; i < futureEvents; i++) undo(rebuilt, transaction => { rebuilt = rebuilt.apply(transaction) })
  rebuilt = rebuilt.apply(rebuilt.tr.setSelection(Selection.fromJSON(rebuilt.doc, original.selection.toJSON())).setMeta('addToHistory', false))
  view.updateState(rebuilt)
}
