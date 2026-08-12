import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { EditorView as CodeMirrorEditorView } from '@codemirror/view'
import { useI18n } from '../../modules/i18n/I18nContext'
import { onNativePaste } from '../../modules/platform/clipboardEvents'
import { createCodeMirrorSearchController, type SearchController, type SearchOptions } from './searchController'
import './SearchBar.css'

interface SearchBarProps {
    view?: CodeMirrorEditorView | null
    controller?: SearchController | null
    onClose: () => void
    prefillText?: string
    prefillVersion?: number
}

export const SearchBar: React.FC<SearchBarProps> = ({ view, controller, onClose, prefillText, prefillVersion }) => {
    const { t } = useI18n()
    const searchController = useMemo(
        () => controller ?? (view ? createCodeMirrorSearchController(view) : null),
        [controller, view],
    )
    const [searchText, setSearchText] = useState(
        () => prefillText ?? searchController?.getInitialSearchText() ?? '',
    )
    const [caseSensitive, setCaseSensitive] = useState(false)
    const [wholeWord, setWholeWord] = useState(false)
    const [regexp, setRegexp] = useState(false)
    const [replaceMode, setReplaceMode] = useState(false)
    const [replaceText, setReplaceText] = useState('')
    const [matchCount, setMatchCount] = useState<number>(0)
    const [currentMatchIndex, setCurrentMatchIndex] = useState<number>(0)

    const inputRef = useRef<HTMLInputElement>(null)
    const replaceInputRef = useRef<HTMLInputElement>(null)

    // Focus input on mount, and cleanup on unmount
    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.focus()
            inputRef.current.select()
        }

        return () => {
            searchController?.clear()
        }
    }, [searchController])

    useEffect(() => {
        if (prefillVersion == null) return
        setSearchText(prefillText ?? '')
        queueMicrotask(() => {
            inputRef.current?.focus()
            inputRef.current?.select()
        })
    }, [prefillText, prefillVersion])

    useEffect(() => {
        const unlisten = onNativePaste((text) => {
            const active = typeof document !== 'undefined' ? document.activeElement : null
            if (active === inputRef.current) {
                setSearchText((prev) => prev + text)
                return
            }
            if (active === replaceInputRef.current) {
                setReplaceText((prev) => prev + text)
            }
        })
        return unlisten
    }, [])

    const getSearchOptions = useCallback((): SearchOptions => ({
        searchText,
        caseSensitive,
        wholeWord,
        regexp,
    }), [caseSensitive, regexp, searchText, wholeWord])

    const applyResult = useCallback((result: { matchCount: number; currentMatchIndex: number }) => {
        setMatchCount(result.matchCount)
        setCurrentMatchIndex(result.currentMatchIndex)
    }, [])

    const updateIndex = useCallback(() => {
        if (!searchController || !searchText) {
            applyResult({ matchCount: 0, currentMatchIndex: 0 })
            return
        }
        applyResult(searchController.apply(getSearchOptions()))
    }, [applyResult, getSearchOptions, searchController, searchText])

    const updateIndexTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Update query and count matches
    useEffect(() => {
        if (!searchController) return
        const result = searchController.apply(getSearchOptions())
        applyResult(result)

        // Count matches — debounce 150ms，避免大文档每次按键都遍历全文
        if (updateIndexTimerRef.current != null) {
            clearTimeout(updateIndexTimerRef.current)
        }
        if (searchText) {
            updateIndexTimerRef.current = setTimeout(() => {
                updateIndex()
            }, 150)
        } else {
            setMatchCount(0)
            setCurrentMatchIndex(0)
        }

        return () => {
            if (updateIndexTimerRef.current != null) {
                clearTimeout(updateIndexTimerRef.current)
            }
        }
    }, [applyResult, getSearchOptions, searchController, searchText, updateIndex])

    const navigate = useCallback((direction: 'next' | 'prev') => {
        if (!searchController || !searchText) return
        applyResult(searchController.navigate(direction, getSearchOptions()))
    }, [applyResult, getSearchOptions, searchController, searchText])

    const handleKeyDown = (e: React.KeyboardEvent) => {
        // 防止外层编辑器或宏命令吃掉输入框里的原生复制、粘贴、全选等快捷键
        if ((e.ctrlKey || e.metaKey) && ['a', 'c', 'v', 'x', 'z'].includes(e.key.toLowerCase())) {
            e.stopPropagation()
        }

        // 如果在输入框内按了回车
        if (e.target === inputRef.current && e.key === 'Enter') {
            if (e.shiftKey) {
                navigate('prev')
            } else {
                navigate('next')
            }
        } else if (e.key === 'Escape') {
            onClose()
        }
    }

    const handleReplace = () => {
        if (!searchController || !searchText) return
        applyResult(searchController.replace(getSearchOptions(), replaceText, false))
    }

    const handleReplaceAll = () => {
        if (!searchController || !searchText) return
        applyResult(searchController.replace(getSearchOptions(), replaceText, true))
    }

    return (
        <div className="search-bar-container" onKeyDown={handleKeyDown}>
            <button
                className="search-bar-toggle"
                onClick={() => setReplaceMode(!replaceMode)}
                title={t('editor.searchToggleReplace')}
            >
                <i className={replaceMode ? 'icon-chevron-down' : 'icon-chevron-right'} />
            </button>

            <div className="search-bar-main">
                <div className="search-row">
                    <div className="search-input-wrapper">
                        <input
                            ref={inputRef}
                            type="text"
                            className="search-input"
                            placeholder={t('editor.searchPlaceholder')}
                            value={searchText}
                            onChange={(e) => setSearchText(e.target.value)}
                        />
                        <div className="search-options">
                            <button
                                className={`search-option-btn ${caseSensitive ? 'active' : ''}`}
                                title={t('editor.searchCaseSensitive')}
                                onClick={() => setCaseSensitive(!caseSensitive)}
                            >
                                Aa
                            </button>
                            <button
                                className={`search-option-btn ${wholeWord ? 'active' : ''}`}
                                title={t('editor.searchWholeWord')}
                                onClick={() => setWholeWord(!wholeWord)}
                            >
                                ab
                            </button>
                            <button
                                className={`search-option-btn ${regexp ? 'active' : ''}`}
                                title={t('editor.searchRegexp')}
                                onClick={() => setRegexp(!regexp)}
                            >
                                .*
                            </button>
                        </div>
                    </div>

                    <div className={`search-status ${searchText && matchCount === 0 ? 'no-results' : ''}`}>
                        {searchText ? (
                            matchCount > 0 ? (
                                `${currentMatchIndex} / ${matchCount}`
                            ) : (
                                t('editor.searchNoResults')
                            )
                        ) : null}
                    </div>

                    <div className="search-actions-group">
                        <div className="search-nav">
                            <button
                                className="search-nav-btn"
                                title={t('editor.searchPrevious')}
                                onClick={() => navigate('prev')}
                                disabled={!searchText || matchCount === 0}
                            >
                                <i className="icon-up" />
                            </button>
                            <button
                                className="search-nav-btn"
                                title={t('editor.searchNext')}
                                onClick={() => navigate('next')}
                                disabled={!searchText || matchCount === 0}
                            >
                                <i className="icon-down" />
                            </button>
                            <button className="search-nav-btn" title={t('editor.searchMoreOptions')}>
                                <i className="icon-menu">
                                    <span></span>
                                    <span></span>
                                    <span></span>
                                </i>
                            </button>
                        </div>
                        <button className="search-close-btn" onClick={onClose} title={t('editor.searchClose')}>
                            <i className="icon-close" />
                        </button>
                    </div>
                </div>

                {replaceMode && (
                    <div className="replace-row">
                        <div className="replace-input-wrapper">
                            <input
                                ref={replaceInputRef}
                                type="text"
                                className="replace-input"
                                placeholder={t('editor.replacePlaceholder')}
                                value={replaceText}
                                onChange={(e) => setReplaceText(e.target.value)}
                                onKeyDown={(e) => {
                                    // 防止外层编辑器或宏命令吃掉输入框里的原生复制、粘贴、全选等快捷键
                                    if ((e.ctrlKey || e.metaKey) && ['a', 'c', 'v', 'x', 'z'].includes(e.key.toLowerCase())) {
                                        e.stopPropagation()
                                    }

                                    if (e.key === 'Enter') {
                                        if (e.metaKey || e.ctrlKey) {
                                            handleReplaceAll()
                                        } else {
                                            handleReplace()
                                        }
                                    }
                                }}
                            />
                            <div className="replace-actions">
                                <button
                                    className="replace-action-btn"
                                    title={t('editor.replaceCurrent')}
                                    disabled={!searchText || matchCount === 0}
                                    onClick={handleReplace}
                                >
                                    <i className="icon-replace" />
                                </button>
                                <button
                                    className="replace-action-btn"
                                    title={t('editor.replaceAll')}
                                    disabled={!searchText || matchCount === 0}
                                    onClick={handleReplaceAll}
                                >
                                    <i className="icon-replace-all" />
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
