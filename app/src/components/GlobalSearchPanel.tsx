import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { SidebarBackgroundShell } from './SidebarBackgroundShell'
import { useI18n } from '../modules/i18n/I18nContext'
import { buildSearchScope } from '../modules/search/searchScopeService'
import { searchWorkspaceContents } from '../modules/search/searchService'
import type { SearchFileResult } from '../modules/search/types'
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
        mode: 'scan',
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
        t('searchPanel.statusSummary', {
          files: result.data.files.length,
          matches: result.data.totalMatches,
        }),
      )
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [query, scope, caseSensitive, wholeWord, regex, onStatusMessage, t])

  return (
    <SidebarBackgroundShell as="aside" className="global-search-panel" style={style}>
      <div className="global-search-panel-header">{t('searchPanel.title')}</div>

      <div className="global-search-panel-controls">
        <div className="global-search-input-row">
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
              {results.files.map((file) => (
                <div key={file.path} className="global-search-file-group">
                  <div className="global-search-file-path" title={file.path}>
                    {file.path}
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
                        <span className="global-search-hit-preview">{hit.preview}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </SidebarBackgroundShell>
  )
})
