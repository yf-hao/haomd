import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type LayoutType = 'preview-left' | 'preview-right' | 'editor-only' | 'preview-only'

const WIDTH_MIN = 30
const WIDTH_MAX = 70
const STORAGE_LAYOUT = 'haomd:layout'
const STORAGE_WIDTH = 'haomd:layout:width'
const STORAGE_SHOW = 'haomd:layout:show'

export function useWorkspaceLayout() {
  const [layout, setLayout] = useState<LayoutType>('preview-left')
  const [showPreview, setShowPreview] = useState(true)
  const [editorWidth, setEditorWidth] = useState(55)
  const [dragging, setDragging] = useState(false)
  const workspaceRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const storedLayout = localStorage.getItem(STORAGE_LAYOUT) as LayoutType | null
    const storedWidth = localStorage.getItem(STORAGE_WIDTH)
    const storedShow = localStorage.getItem(STORAGE_SHOW)
    if (storedLayout) {
      setLayout(storedLayout)
    }
    if (storedWidth) {
      const w = Number(storedWidth)
      if (!Number.isNaN(w)) setEditorWidth(w)
    }
    if (storedShow != null) {
      setShowPreview(storedShow !== 'false')
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_LAYOUT, layout)
    localStorage.setItem(STORAGE_WIDTH, String(editorWidth))
    localStorage.setItem(STORAGE_SHOW, String(showPreview))
  }, [layout, editorWidth, showPreview])

  const effectiveLayout = useMemo<LayoutType>(() => {
    if (!showPreview) return 'editor-only'
    return layout
  }, [layout, showPreview])

  const clampedEditorWidth = useMemo(
    () => Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, editorWidth)),
    [editorWidth],
  )
  const clampedPreviewWidth = useMemo(
    () => Math.max(WIDTH_MIN, 100 - clampedEditorWidth),
    [clampedEditorWidth],
  )
  const previewWidthForRender = useMemo(
    () => (effectiveLayout === 'preview-only' ? 100 : clampedPreviewWidth),
    [clampedPreviewWidth, effectiveLayout],
  )

  const gridTemplateColumns = useMemo(() => {
    const previewCol = `minmax(0, ${clampedPreviewWidth}%)`
    const editorCol = `minmax(0, ${clampedEditorWidth}%)`

    if (effectiveLayout === 'preview-left') return `${previewCol} ${editorCol}`
    if (effectiveLayout === 'preview-right') return `${editorCol} ${previewCol}`
    if (effectiveLayout === 'preview-only') return '1fr 0'
    // editor-only
    return '0 1fr'
  }, [clampedEditorWidth, clampedPreviewWidth, effectiveLayout])

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!dragging || !workspaceRef.current) return
      const rect = workspaceRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      const percent = (x / rect.width) * 100
      const clamped = Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, percent))
      if (effectiveLayout === 'preview-left') {
        setEditorWidth(Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, 100 - clamped)))
      } else {
        setEditorWidth(clamped)
      }
    }
    const handleUp = () => dragging && setDragging(false)
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [dragging, effectiveLayout])

  const startDragging = useCallback((e?: { preventDefault?: () => void } | null) => {
    e?.preventDefault?.()
    setDragging(true)
  }, [])

  return {
    layout,
    setLayout,
    showPreview,
    setShowPreview,
    editorWidth,
    setEditorWidth,
    dragging,
    workspaceRef,
    effectiveLayout,
    gridTemplateColumns,
    previewWidthForRender,
    startDragging,
  }
}
