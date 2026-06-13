export type ImportedWordState = {
  kind: 'word-import'
  sourceDocxPath: string
  tempDir: string
  tempMarkdownPath: string
  tempImagesDir: string
  needsSaveAs: true
}

export type ImportedWordDocument = {
  markdown: string
  tempDir: string
  tempMarkdownPath: string
  tempImagesDir: string
  sourceDocxPath: string
  warnings: string[]
}

export type FinalizedImportedWordDocument = {
  markdown: string
  savedPath: string
  assetsDir: string
}
