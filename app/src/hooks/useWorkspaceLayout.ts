import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react'

export type LayoutType = 'preview-left' | 'preview-right' | 'editor-only' | 'preview-only'

const WIDTH_MIN = 30
const WIDTH_MAX = 70
const STORAGE_LAYOUT = 'haomd:layout'
const STORAGE_WIDTH = 'haomd:layout:width'
const STORAGE_SHOW = 'haomd:layout:show'
const STORAGE_SHOW_EDITOR = 'haomd:layout:show-editor'

function isLayoutType(value: string | null): value is LayoutType {
  return value === 'preview-left' || value === 'preview-right' || value === 'editor-only' || value === 'preview-only'
}

type LayoutState = {
  layout: LayoutType
  showEditor: boolean
  showPreview: boolean
}

function readInitialLayoutState(): LayoutState {
  if (typeof localStorage === 'undefined') {
    return { layout: 'preview-left', showEditor: true, showPreview: true }
  }

  const storedLayout = localStorage.getItem(STORAGE_LAYOUT)
  const layout = isLayoutType(storedLayout) ? storedLayout : 'preview-left'
  const storedShowPreview = localStorage.getItem(STORAGE_SHOW)
  const storedShowEditor = localStorage.getItem(STORAGE_SHOW_EDITOR)
  const showPreview = storedShowPreview == null ? true : storedShowPreview !== 'false'
  const showEditor = storedShowEditor == null ? layout !== 'preview-only' : storedShowEditor !== 'false'

  return { layout, showEditor, showPreview }
}

export function useWorkspaceLayout() {
  // 布局方向和面板可见性使用同一个状态对象，始终从同一快照计算布局。
  const [layoutState, setLayoutState] = useState<LayoutState>(readInitialLayoutState)
  const { layout, showEditor, showPreview } = layoutState

  const setLayout = useCallback((value: SetStateAction<LayoutType>) => {
    setLayoutState((currentState) => ({
      ...currentState,
      layout: typeof value === 'function' ? value(currentState.layout) : value,
    }))
  }, [])

  // 保留旧的 setter API，命令系统可以继续使用函数式更新，但实际只更新 layout 一次。
  const setShowEditor = useCallback((value: SetStateAction<boolean>) => {
    setLayoutState((currentState) => {
      const currentVisible = currentState.showEditor
      const nextVisible = typeof value === 'function' ? value(currentVisible) : value
      return { ...currentState, showEditor: nextVisible }
    })
  }, [])
  const setShowPreview = useCallback((value: SetStateAction<boolean>) => {
    setLayoutState((currentState) => {
      const currentVisible = currentState.showPreview
      const nextVisible = typeof value === 'function' ? value(currentVisible) : value
      return { ...currentState, showPreview: nextVisible }
    })
  }, [])

  const [editorWidth, setEditorWidth] = useState<number>(() => {
    if (typeof localStorage === 'undefined') return 55
    const storedWidth = localStorage.getItem(STORAGE_WIDTH)
    if (!storedWidth) return 55
    const w = Number(storedWidth)
    return Number.isNaN(w) ? 55 : w
  })
  const [dragging, setDragging] = useState(false)
  const workspaceRef = useRef<HTMLElement | null>(null)

  // 将布局和宽度持久化到 localStorage，但避免在拖动过程中高频同步 I/O
  useEffect(() => {
    if (typeof localStorage === 'undefined') return
    // 拖动时只更新 UI，不写入 localStorage，等拖动结束后再保存一次最终结果
    if (dragging) return

    const timer = setTimeout(() => {
      localStorage.setItem(STORAGE_LAYOUT, layout)
      localStorage.setItem(STORAGE_WIDTH, String(editorWidth))
      localStorage.setItem(STORAGE_SHOW, String(showPreview))
      localStorage.setItem(STORAGE_SHOW_EDITOR, String(showEditor))
    }, 200)

    return () => {
      clearTimeout(timer)
    }
  }, [layout, editorWidth, showPreview, showEditor, dragging])

  const effectiveLayout = useMemo<LayoutType>(() => {
    if (!showEditor && showPreview) return 'preview-only'
    if (!showPreview) return 'editor-only'
    if (layout === 'editor-only' || layout === 'preview-only') return 'preview-right'
    return layout
  }, [layout, showEditor, showPreview])

  const clampedEditorWidth = useMemo(
    () => Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, editorWidth)),
    [editorWidth],
  )
  const clampedPreviewWidth = useMemo(
    () => Math.max(WIDTH_MIN, 100 - clampedEditorWidth),
    [clampedEditorWidth],
  )
  const previewWidthForRender = useMemo(
    () => (!showEditor ? 100 : clampedPreviewWidth),
    [clampedPreviewWidth, showEditor],
  )

  const gridTemplateColumns = useMemo(() => {
    const previewCol = `minmax(0, ${clampedPreviewWidth}%)`
    const editorCol = `minmax(0, ${clampedEditorWidth}%)`

    if (!showEditor && !showPreview) return '0 0'
    if (!showEditor) return '1fr 0'
    if (!showPreview) return '0 1fr'
    if (layout === 'preview-left') return `${previewCol} ${editorCol}`
    return `${editorCol} ${previewCol}`
  }, [clampedEditorWidth, clampedPreviewWidth, layout, showEditor, showPreview])

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
    showEditor,
    setShowEditor,
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
