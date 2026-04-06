import React, { useState, useEffect, useRef, useCallback } from 'react'
import { setSearchQuery, findNext, findPrevious, SearchQuery, replaceNext, replaceAll } from '@codemirror/search'
import { setCustomSearchQuery } from './searchHighlight'
import { useI18n } from '../../modules/i18n/I18nContext'
import { onNativePaste } from '../../modules/platform/clipboardEvents'
import './SearchBar.css'

interface SearchBarProps {
    view: any
    onClose: () => void
    prefillText?: string
    prefillVersion?: number
}

function getInitialSearchText(view: any): string {
    if (!view?.state?.selection?.main || !view?.state?.sliceDoc) return ''
    const selection = view.state.selection.main
    if (selection.empty) return ''
    return view.state.sliceDoc(selection.from, selection.to)
}

export const SearchBar: React.FC<SearchBarProps> = ({ view, onClose, prefillText, prefillVersion }) => {
    const { t } = useI18n()
    const [searchText, setSearchText] = useState(() => prefillText ?? getInitialSearchText(view))
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
            if (view) {
                view.dispatch({
                    effects: [
                        setSearchQuery.of(new SearchQuery({ search: '' })),
                        setCustomSearchQuery.of(null)
                    ]
                })
            }
        }
    }, [view])

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

    const updateIndex = useCallback(() => {
        if (!view || !searchText) return;
        const query = new SearchQuery({ search: searchText, caseSensitive, wholeWord, regexp });
        const cursor = query.getCursor(view.state) as any;
        const head = view.state.selection.main.head;
        let count = 0;
        let foundIndex = 0;

        while (!cursor.next().done) {
            count++;
            if (!foundIndex) {
                const matchFrom = cursor.value?.from ?? cursor.from;
                const matchTo = cursor.value?.to ?? cursor.to;
                if (matchFrom >= head || (matchFrom < head && matchTo >= head)) {
                    foundIndex = count;
                }
            }
        }

        setMatchCount(count);
        setCurrentMatchIndex(count > 0 ? (foundIndex || count) : 0);
    }, [view, searchText, caseSensitive, wholeWord, regexp]);

    const updateIndexTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Update query and count matches
    useEffect(() => {
        if (!view) return

        const query = new SearchQuery({
            search: searchText,
            caseSensitive,
            wholeWord,
            regexp,
        })

        // Apply query to CodeMirror (this handles highlighting) — 立即执行，保证视觉反馈
        view.dispatch({
            effects: [
                setSearchQuery.of(query),
                setCustomSearchQuery.of(query)
            ]
        })

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
    }, [view, searchText, caseSensitive, wholeWord, regexp, updateIndex])

    const navigate = useCallback((direction: 'next' | 'prev') => {
        if (!view || !searchText) return

        if (direction === 'next') {
            findNext(view as any)
        } else {
            // 为了防止向后查找时因为光标在当前匹配词末尾而反复匹配当前词
            // 先尝试把光标移到当前匹配词的开头
            const query = new SearchQuery({ search: searchText, caseSensitive, wholeWord, regexp })
            const cursor = query.getCursor(view.state) as any
            const head = view.state.selection.main.head
            let matchFrom = null

            while (!cursor.next().done) {
                const f = cursor.value?.from ?? cursor.from
                const t = cursor.value?.to ?? cursor.to
                if (t === head) {
                    matchFrom = f
                    break
                }
            }

            if (matchFrom !== null) {
                view.dispatch({
                    selection: { anchor: matchFrom, head: matchFrom }
                })
            }

            findPrevious(view as any)
        }

        // After navigation, CodeMirror selects the match.
        // User requirement: positioning the cursor AFTER the match text.
        const { selection } = view.state
        if (!selection.main.empty) {
            const targetPos = selection.main.to
            view.dispatch({
                selection: { anchor: targetPos, head: targetPos },
                scrollIntoView: true,
                userEvent: 'select.search'
            })
        }

        updateIndex()
    }, [view, searchText, caseSensitive, wholeWord, regexp, updateIndex])

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
        if (!view || !searchText) return
        const query = new SearchQuery({
            search: searchText,
            caseSensitive,
            wholeWord,
            regexp,
            replace: replaceText
        })
        view.dispatch({ effects: setSearchQuery.of(query) })
        replaceNext(view as any)
        updateIndex()
    }

    const handleReplaceAll = () => {
        if (!view || !searchText) return
        const query = new SearchQuery({
            search: searchText,
            caseSensitive,
            wholeWord,
            regexp,
            replace: replaceText
        })
        view.dispatch({ effects: setSearchQuery.of(query) })
        replaceAll(view as any)
        updateIndex()
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
