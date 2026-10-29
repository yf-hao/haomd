import { ChangeSet, Compartment, Transaction, EditorState } from '@codemirror/state'
import { history, historyField, undo, redo } from '@codemirror/commands'
import type { EditorView } from '@codemirror/view'
import { applyTextPatches, planReferenceRelocation, type FileRelocation } from '../../modules/markdown/references/relocationPlanner'

export const documentHistory = new Compartment()
export const documentHistoryExtension = () => documentHistory.of(history())

function difference(before: string, after: string) {
  let from = 0
  while (from < before.length && from < after.length && before[from] === after[from]) from++
  let tail = 0
  while (tail < before.length - from && tail < after.length - from && before[before.length - tail - 1] === after[after.length - tail - 1]) tail++
  return { from, to: before.length - tail, insert: after.slice(from, after.length - tail) }
}

/** Rebase history snapshots too: undo must not resurrect URLs using the old folder. */
export function relocateCodeMirrorDocument(view: EditorView, path: string, move: FileRelocation): string {
  const original = view.state
  const transform = (state: EditorState) => {
    const value = state.doc.toString()
    const patches = planReferenceRelocation(value, path, move)
    const changes = ChangeSet.of(patches, value.length)
    return { content: applyTextPatches(value, patches), selection: state.selection.map(changes), changes }
  }
  const current = transform(original)
  const branch = (command: typeof undo) => {
    let state = original
    let before = current.content
    const events = []
    while (command({ state, dispatch: transaction => { state = transaction.state } })) {
      const after = transform(state)
      events.push({ changes: ChangeSet.of(difference(before, after.content), before.length).toJSON(),
        startSelection: after.selection.toJSON(), selectionsAfter: [] })
      before = after.content
    }
    return events.reverse()
  }
  if (!original.field(historyField, false) || !documentHistory.get(original)) {
    view.dispatch({ changes: current.changes, annotations: Transaction.addToHistory.of(false) })
    return current.content
  }
  const rebuilt = EditorState.fromJSON({ doc: current.content, selection: current.selection.toJSON(),
    history: { done: branch(undo), undone: branch(redo) } }, { extensions: [history()] }, { history: historyField }).field(historyField)
  view.dispatch({ changes: current.changes, effects: documentHistory.reconfigure([]),
    annotations: Transaction.addToHistory.of(false) })
  view.dispatch({ effects: documentHistory.reconfigure([history(), historyField.init(() => rebuilt)]),
    annotations: Transaction.addToHistory.of(false) })
  return current.content
}
