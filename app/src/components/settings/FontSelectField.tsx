import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import './FontSelectField.css'
import {
  loadAvailableFonts,
  searchFonts,
  type FontOption,
} from '../../modules/fonts/fontCatalogService'

type FontSelectFieldProps = {
  value: string
  onChange: (nextValue: string) => void
}

export function FontSelectField({
  value,
  onChange,
}: FontSelectFieldProps) {
  const [fonts, setFonts] = useState<FontOption[]>([])
  const [isExpanded, setIsExpanded] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const highlightedIndexRef = useRef(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    void loadAvailableFonts()
      .then((loadedFonts) => {
        if (cancelled) return
        setFonts(loadedFonts)
      })
      .catch((err: Error) => {
        if (cancelled) return
        setFonts([])
        setError(err.message || 'Failed to load fonts')
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const filteredFonts = useMemo(() => searchFonts(fonts, searchKeyword), [fonts, searchKeyword])
  const groupedFonts = useMemo(() => {
    const system: FontOption[] = []

    for (const font of filteredFonts) {
      if (font.source === 'system') {
        system.push(font)
      }
    }

    return { system }
  }, [filteredFonts])
  const selectableFonts = useMemo(
    () => [...groupedFonts.system],
    [groupedFonts.system],
  )

  useEffect(() => {
    if (!selectableFonts.length) {
      updateHighlightedIndex(0)
      return
    }

    const selectedIndex = [...groupedFonts.system]
      .findIndex((font) => font.family === value)
    updateHighlightedIndex(selectedIndex >= 0 ? selectedIndex : 0)
  }, [fonts, searchKeyword, value])

  const handleSelectFont = (family: string) => {
    onChange(family)
    setIsExpanded(false)
  }

  const updateHighlightedIndex = (nextIndex: number) => {
    highlightedIndexRef.current = nextIndex
    setHighlightedIndex(nextIndex)
  }

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!selectableFonts.length) {
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      updateHighlightedIndex(Math.min(highlightedIndexRef.current + 1, selectableFonts.length - 1))
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      updateHighlightedIndex(Math.max(highlightedIndexRef.current - 1, 0))
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      const target = selectableFonts[highlightedIndexRef.current]
      if (target) {
        handleSelectFont(target.family)
      }
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setIsExpanded(false)
    }
  }

  let optionCursor = -1
  const renderFontGroup = (title: string, items: FontOption[]) => {
    if (!items.length) return null
    return (
      <div className="font-select-group">
        <div className="font-select-group-title">{title}</div>
        <div className="font-select-group-list">
          {items.map((font) => {
            optionCursor += 1
            const isHighlighted = highlightedIndex === optionCursor
            return (
              <button
                key={`${font.source}:${font.family}`}
                type="button"
                className={`font-select-option ${font.family === value ? 'active' : ''} ${isHighlighted ? 'highlighted' : ''}`}
                onClick={() => handleSelectFont(font.family)}
              >
                <span className="font-select-option-name">{font.displayName}</span>
                <span className="font-select-option-source">{font.source}</span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="font-select-field">
      <button
        type="button"
        className={`font-select-toggle ${isExpanded ? 'expanded' : ''}`}
        onClick={() => setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
      >
        <span className="font-select-toggle-value">{value.trim() || 'No font selected'}</span>
      </button>

      {isExpanded && (
        <div className="font-select-panel">
          <input
            className="field-input font-select-search"
            value={searchKeyword}
            onChange={(event) => setSearchKeyword(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search fonts"
          />

          {loading && <div className="font-select-state">Loading fonts...</div>}
          {!loading && error && <div className="font-select-state font-select-state-error">{error}</div>}
          {!loading && (
            <>
              {renderFontGroup('System Fonts', groupedFonts.system)}
              {!groupedFonts.system.length && (
                <div className="font-select-state">No fonts matched your search.</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
