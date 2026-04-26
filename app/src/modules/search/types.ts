export type SearchMode = 'scan'

export type SearchScope = {
  folderRoots: string[]
  standaloneFiles: string[]
}

export type SearchRequest = {
  requestId: string
  mode: SearchMode
  query: string
  scope: SearchScope
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
  maxResults?: number
  maxHitsPerFile?: number
}

export type SearchHit = {
  line: number
  columnStart: number
  columnEnd: number
  preview: string
}

export type SearchFileResult = {
  path: string
  matchCount: number
  hits: SearchHit[]
}

export type SearchExecutionInfo = {
  strategy: 'single-thread' | 'parallel'
  workers: number
}

export type SearchResponse = {
  files: SearchFileResult[]
  totalMatches: number
  totalFilesScanned: number
  truncated: boolean
  execution?: SearchExecutionInfo
  requestId?: string
}
