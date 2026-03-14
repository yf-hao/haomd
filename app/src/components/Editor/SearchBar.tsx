import React, { useState, useEffect, useRef, useCallback } from 'react'
import { setSearchQuery, findNext, findPrevious, SearchQuery, replaceNext, replaceAll } from '@codemirror/search'
import { setCustomSearchQuery } from './searchHighlight'
import './SearchBar.css'

interface SearchBarProps {
    view: any
    onClose: () => void
}

export const SearchBar: React.FC<SearchBarProps> = ({ view, onClose }) => {
    const [searchText, setSearchText] = useState('')
    const [caseSensitive, setCaseSensitive] = useState(false)
    const [wholeWord, setWholeWord] = useState(false)
    const [regexp, setRegexp] = useState(false)
    const [replaceMode, setReplaceMode] = useState(false)
    const [replaceText, setReplaceText] = useState('')
    const [matchCount, setMatchCount] = useState<number>(0)
    const [currentMatchIndex, setCurrentMatchIndex] = useState<number>(0)

    const inputRef = useRef<HTMLInputElement>(null)

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
                title="切换替换"
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
                            placeholder="查找文本..."
                            value={searchText}
                            onChange={(e) => setSearchText(e.target.value)}
                        />
                        <div className="search-options">
                            <button
                                className={`search-option-btn ${caseSensitive ? 'active' : ''}`}
                                title="区分大小写"
                                onClick={() => setCaseSensitive(!caseSensitive)}
                            >
                                Aa
                            </button>
                            <button
                                className={`search-option-btn ${wholeWord ? 'active' : ''}`}
                                title="全词匹配"
                                onClick={() => setWholeWord(!wholeWord)}
                            >
                                ab
                            </button>
                            <button
                                className={`search-option-btn ${regexp ? 'active' : ''}`}
                                title="正则表达式"
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
                                '无匹配结果'
                            )
                        ) : null}
                    </div>

                    <div className="search-actions-group">
                        <div className="search-nav">
                            <button
                                className="search-nav-btn"
                                title="上一个 (Shift+Enter)"
                                onClick={() => navigate('prev')}
                                disabled={!searchText || matchCount === 0}
                            >
                                <i className="icon-up" />
                            </button>
                            <button
                                className="search-nav-btn"
                                title="下一个 (Enter)"
                                onClick={() => navigate('next')}
                                disabled={!searchText || matchCount === 0}
                            >
                                <i className="icon-down" />
                            </button>
                            <button className="search-nav-btn" title="更多选项">
                                <i className="icon-menu">
                                    <span></span>
                                    <span></span>
                                    <span></span>
                                </i>
                            </button>
                        </div>
                        <button className="search-close-btn" onClick={onClose} title="关闭 (Esc)">
                            <i className="icon-close" />
                        </button>
                    </div>
                </div>

                {replaceMode && (
                    <div className="replace-row">
                        <div className="replace-input-wrapper">
                            <input
                                type="text"
                                className="replace-input"
                                placeholder="替换为..."
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
                                    title="替换当前 (Enter)"
                                    disabled={!searchText || matchCount === 0}
                                    onClick={handleReplace}
                                >
                                    <i className="icon-replace" />
                                </button>
                                <button
                                    className="replace-action-btn"
                                    title="全部替换 (Cmd/Ctrl+Enter)"
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
