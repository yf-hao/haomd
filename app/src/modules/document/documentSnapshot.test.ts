import { expect, it, vi } from 'vitest'
import { createDocumentSnapshot } from './documentSnapshot'

it('captures an immutable version and memoizes materialization, including empty documents', () => {
  const version = { documentId: 'doc', sessionId: 'session', revision: 1 }
  let model = { text: '' }
  const serialize = vi.fn(doc => doc.text)
  const snapshot = createDocumentSnapshot(version, model, serialize)
  version.revision++
  model = { text: 'later' }
  expect(serialize).not.toHaveBeenCalled()
  expect(snapshot.version.revision).toBe(1)
  expect(snapshot.readMarkdown()).toBe('')
  expect(snapshot.readMarkdown()).toBe('')
  expect(serialize).toHaveBeenCalledOnce()
  expect(model.text).toBe('later')
})
