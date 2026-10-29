/** Shared by manual saves, autosaves and moves. Work reads paths when it runs. */
export interface DocumentOperationQueue {
  run<T>(operation: () => Promise<T>): Promise<T>
}

export class DocumentOperationCoordinator implements DocumentOperationQueue {
  private tail: Promise<void> | null = null
  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail ? this.tail.then(operation) : operation()
    const tail = result.then(() => {}, () => {})
    this.tail = tail
    void tail.then(() => { if (this.tail === tail) this.tail = null })
    return result
  }
}

// A move and a queued save must observe the same path and saved version. Keep
// their writes and completion callbacks in one ordering domain.
export const workspaceDocumentOperations = new DocumentOperationCoordinator()
