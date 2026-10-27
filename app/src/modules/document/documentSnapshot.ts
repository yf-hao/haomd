export type DocumentVersion = Readonly<{
  documentId: string
  sessionId: string
  revision: number
}>

export interface DocumentSnapshot {
  readonly version: DocumentVersion
  readMarkdown(): string
}

/** Capture an immutable native model; materialize text only when a consumer needs it. */
export function createDocumentSnapshot<Model>(
  version: DocumentVersion,
  model: Model,
  serialize: (model: Model) => string,
): DocumentSnapshot {
  let text: string | undefined
  return {
    version: Object.freeze({ ...version }),
    readMarkdown: () => text ??= serialize(model),
  }
}
