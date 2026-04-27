import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { SidebarBackgroundShell } from './SidebarBackgroundShell'
import { useI18n } from '../modules/i18n/I18nContext'
import { buildSearchScope } from '../modules/search/searchScopeService'
import { searchWorkspaceContents } from '../modules/search/searchService'
import type { SearchExecutionInfo, SearchFileResult } from '../modules/search/types'
import { getSearchSettings } from '../modules/settings/editorSettings'
import './GlobalSearchPanel.css'

export type GlobalSearchPanelProps = {
  panelWidth?: number
  folderRoots: string[]
  standaloneFiles: Array<{ path: string }>
  onOpenResult: (params: {
    path: string
    line: number
    columnStart: number
    searchText: string
    caseSensitive: boolean
    wholeWord: boolean
    regex: boolean
  }) => void
  onStatusMessage?: (message: string) => void
}

const SEARCH_DEBOUNCE_MS = 250
const initialGlobalSearchPanelCache = () => ({
  query: '',
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  errorMessage: '',
  results: summarizeResult([], 0, 0, false),
})
const globalSearchPanelCache = initialGlobalSearchPanelCache()

export function resetGlobalSearchPanelCache() {
  Object.assign(globalSearchPanelCache, initialGlobalSearchPanelCache())
}

function summarizeResult(files: SearchFileResult[], totalMatches: number, totalFilesScanned: number, truncated: boolean) {
  return {
    files,
    totalMatches,
    totalFilesScanned,
    truncated,
  }
}

function buildSearchStatusSummary(
  t: ReturnType<typeof useI18n>['t'],
  execution: SearchExecutionInfo | undefined,
  files: number,
  matches: number,
) {
  if (execution?.engine === 'fts5') {
    const candidates = execution.candidateFiles ?? files
    if (execution.strategy === 'parallel') {
      return t('searchPanel.statusSummaryFts5Parallel', {
        workers: execution.workers,
        candidates,
        matches,
      })
    }

    return t('searchPanel.statusSummaryFts5Single', {
      candidates,
      matches,
    })
  }

  if (execution?.strategy === 'parallel') {
    return t('searchPanel.statusSummaryParallel', {
      workers: execution.workers,
      files,
      matches,
    })
  }

  return t('searchPanel.statusSummarySingle', {
    files,
    matches,
  })
}

type SearchToggleButtonProps = {
  active: boolean
  label: string
  icon: string
  onClick: () => void
}

function SearchToggleButton({ active, label, icon, onClick }: SearchToggleButtonProps) {
  return (
    <button
      type="button"
      className={`global-search-toggle ${active ? 'is-active' : ''}`}
      aria-pressed={active}
      title={label}
      onClick={onClick}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  )
}

function splitDisplayPath(path: string) {
  const normalized = path.replace(/\\/g, '/')
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash < 0) {
    return { fileName: normalized, parentPath: '' }
  }
  return {
    fileName: normalized.slice(lastSlash + 1),
    parentPath: normalized.slice(0, lastSlash),
  }
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function renderPreview(preview: string, query: string, caseSensitive: boolean, regex: boolean) {
  const trimmed = query.trim()
  if (!trimmed) return preview
  if (regex) return preview

  const safePattern = escapeRegExp(trimmed)
  const flags = caseSensitive ? 'g' : 'gi'
  const matcher = new RegExp(safePattern, flags)
  const parts = preview.split(matcher)
  const matches = preview.match(matcher)
  if (!matches || parts.length === 1) return preview

  return parts.flatMap((part, index) => {
    if (index >= matches.length) return [part]
    return [
      part,
      <mark key={`m-${index}`} className="global-search-hit-mark">
        {matches[index]}
      </mark>,
    ]
  })
}

export const GlobalSearchPanel = memo(function GlobalSearchPanel({
  panelWidth,
  folderRoots,
  standaloneFiles,
  onOpenResult,
  onStatusMessage,
}: GlobalSearchPanelProps) {
  const { t } = useI18n()
  const style = panelWidth ? { width: panelWidth } : undefined
  const [query, setQuery] = useState(() => globalSearchPanelCache.query)
  const [caseSensitive, setCaseSensitive] = useState(() => globalSearchPanelCache.caseSensitive)
  const [wholeWord, setWholeWord] = useState(() => globalSearchPanelCache.wholeWord)
  const [regex, setRegex] = useState(() => globalSearchPanelCache.regex)
  const [fts5Enabled, setFts5Enabled] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState(() => globalSearchPanelCache.errorMessage)
  const [results, setResults] = useState(() => globalSearchPanelCache.results)
  const requestSeqRef = useRef(0)

  const scope = useMemo(
    () => buildSearchScope({ folderRoots, standaloneFiles }),
    [folderRoots, standaloneFiles],
  )

  useEffect(() => {
    globalSearchPanelCache.query = query
    globalSearchPanelCache.caseSensitive = caseSensitive
    globalSearchPanelCache.wholeWord = wholeWord
    globalSearchPanelCache.regex = regex
    globalSearchPanelCache.errorMessage = errorMessage
    globalSearchPanelCache.results = results
  }, [query, caseSensitive, wholeWord, regex, errorMessage, results])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const settings = await getSearchSettings()
      if (cancelled) return
      setFts5Enabled(settings.fts5Enabled)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const trimmed = query.trim()
    const currentRequestId = String(++requestSeqRef.current)

    if (!trimmed) {
      setLoading(false)
      setErrorMessage('')
      setResults(summarizeResult([], 0, 0, false))
      return
    }

    const timer = window.setTimeout(async () => {
      setLoading(true)
      setErrorMessage('')

      const result = await searchWorkspaceContents({
        requestId: currentRequestId,
        mode: fts5Enabled && !regex ? 'fts5' : 'scan',
        query: trimmed,
        scope,
        caseSensitive,
        wholeWord,
        regex,
        maxResults: 200,
        maxHitsPerFile: 20,
      })

      if (requestSeqRef.current.toString() !== currentRequestId) {
        return
      }

      setLoading(false)

      if (!result.ok) {
        setResults(summarizeResult([], 0, 0, false))
        setErrorMessage(result.message)
        onStatusMessage?.(result.message)
        return
      }

      setResults(
        summarizeResult(
          result.data.files,
          result.data.totalMatches,
          result.data.totalFilesScanned,
          result.data.truncated,
        ),
      )

      onStatusMessage?.(
        buildSearchStatusSummary(
          t,
          result.data.execution,
          result.data.files.length,
          result.data.totalMatches,
        ),
      )
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [query, scope, caseSensitive, wholeWord, regex, fts5Enabled, onStatusMessage, t])

  return (
    <SidebarBackgroundShell as="aside" className="global-search-panel" style={style}>
      <div className="global-search-panel-header">{t('searchPanel.title')}</div>

      <div className="global-search-panel-controls">
        <div className="global-search-input-row">
          <div className="global-search-input-shell">
            <input
              className="global-search-input"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPanel.placeholder')}
            />
            <div className="global-search-inline-actions">
              <SearchToggleButton
                active={caseSensitive}
                label={t('searchPanel.caseSensitive')}
                icon="Aa"
                onClick={() => setCaseSensitive((prev) => !prev)}
              />
              <SearchToggleButton
                active={wholeWord}
                label={t('searchPanel.wholeWord')}
                icon="[ab]"
                onClick={() => setWholeWord((prev) => !prev)}
              />
              <SearchToggleButton
                active={regex}
                label={t('searchPanel.regex')}
                icon=".*"
                onClick={() => setRegex((prev) => !prev)}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="global-search-panel-body">
        {!query.trim() ? (
          <div className="global-search-empty">{t('searchPanel.empty')}</div>
        ) : loading ? (
          <div className="global-search-empty">{t('searchPanel.searching')}</div>
        ) : errorMessage ? (
          <div className="global-search-empty error">{errorMessage}</div>
        ) : results.files.length === 0 ? (
          <div className="global-search-empty">{t('searchPanel.noResults')}</div>
        ) : (
          <>
            <div className="global-search-summary">
              {t('searchPanel.summary', {
                files: results.files.length,
                matches: results.totalMatches,
                scanned: results.totalFilesScanned,
              })}
              {results.truncated ? <span> · {t('searchPanel.truncated')}</span> : null}
            </div>
            <div className="global-search-results">
              {results.files.map((file) => {
                const display = splitDisplayPath(file.path)
                return (
                <div key={file.path} className="global-search-file-group">
                  <div className="global-search-file-header" title={file.path}>
                    <div className="global-search-file-meta">
                      <div className="global-search-file-name">{display.fileName}</div>
                      <div className="global-search-file-path">
                        {display.parentPath || file.path}
                      </div>
                    </div>
                    <div className="global-search-file-count">{file.matchCount}</div>
                  </div>
                  <div className="global-search-hit-list">
                    {file.hits.map((hit, index) => (
                      <button
                        key={`${file.path}:${hit.line}:${hit.columnStart}:${index}`}
                        type="button"
                        className="global-search-hit"
                        onClick={() =>
                          onOpenResult({
                          path: file.path,
                          line: hit.line,
                          columnStart: hit.columnStart,
                          searchText: query.trim(),
                          caseSensitive,
                          wholeWord,
                            regex,
                          })}
                      >
                        <span className="global-search-hit-line">{hit.line}</span>
                        <span className="global-search-hit-preview">
                          {renderPreview(hit.preview, query, caseSensitive, regex)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )})}
            </div>
          </>
        )}
      </div>
    </SidebarBackgroundShell>
  )
})
