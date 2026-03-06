import React, { useState, useEffect, useRef, useCallback } from 'react'
import { setSearchQuery, findNext, findPrevious, SearchQuery } from '@codemirror/search'
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
        let cursor = query.getCursor(view.state) as any;
        let count = 0;
        while (!cursor.next().done) {
            count++;
        }
        setMatchCount(count);

        if (count > 0) {
            let index = 1;
            const head = view.state.selection.main.head;
            cursor = query.getCursor(view.state) as any;
            while (!cursor.next().done) {
                const matchFrom = cursor.value?.from ?? cursor.from;
                const matchTo = cursor.value?.to ?? cursor.to;
                if (matchFrom >= head || (matchFrom < head && matchTo >= head)) {
                    break;
                }
                index++;
            }
            setCurrentMatchIndex(Math.min(index, count));
        } else {
            setCurrentMatchIndex(0);
        }
    }, [view, searchText, caseSensitive, wholeWord, regexp]);

    // Update query and count matches
    useEffect(() => {
        if (!view) return

        const query = new SearchQuery({
            search: searchText,
            caseSensitive,
            wholeWord,
            regexp,
        })

        // Apply query to CodeMirror (this handles highlighting)
        view.dispatch({
            effects: [
                setSearchQuery.of(query),
                setCustomSearchQuery.of(query)
            ]
        })

        // Count matches manually for the UI
        if (searchText) {
            updateIndex();
        } else {
            setMatchCount(0)
            setCurrentMatchIndex(0)
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
        if (e.key === 'Enter') {
            if (e.shiftKey) {
                navigate('prev')
            } else {
                navigate('next')
            }
        } else if (e.key === 'Escape') {
            onClose()
        }
    }

    return (
        <div className="search-bar-container" onKeyDown={handleKeyDown}>
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
    )
}
