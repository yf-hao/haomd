import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWorkspaceLayout } from './useWorkspaceLayout'

const STORAGE_LAYOUT = 'haomd:layout'
const STORAGE_WIDTH = 'haomd:layout:width'
const STORAGE_SHOW = 'haomd:layout:show'

describe('useWorkspaceLayout', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should initialize with defaults when localStorage is empty', () => {
    const { result } = renderHook(() => useWorkspaceLayout())

    expect(result.current.layout).toBe('preview-left')
    expect(result.current.showPreview).toBe(true)
    expect(result.current.editorWidth).toBe(55)
    expect(result.current.effectiveLayout).toBe('preview-left')
    expect(result.current.gridTemplateColumns).toBe('minmax(0, 45%) minmax(0, 55%)')
  })

  it('should initialize from localStorage when values are present', () => {
    window.localStorage.setItem(STORAGE_LAYOUT, 'preview-right')
    window.localStorage.setItem(STORAGE_WIDTH, '40')
    window.localStorage.setItem(STORAGE_SHOW, 'false')

    const { result } = renderHook(() => useWorkspaceLayout())

    expect(result.current.layout).toBe('preview-right')
    expect(result.current.showPreview).toBe(false)
    // editorWidth 使用存储值
    expect(result.current.editorWidth).toBe(40)
    // showPreview=false 时，effectiveLayout 强制为 editor-only
    expect(result.current.effectiveLayout).toBe('editor-only')
    expect(result.current.gridTemplateColumns).toBe('0 1fr')
  })

  it('should persist layout, width and showPreview to localStorage when not dragging', () => {
    vi.useFakeTimers()

    const { result } = renderHook(() => useWorkspaceLayout())

    act(() => {
      result.current.setLayout('preview-right')
      result.current.setShowPreview(false)
      result.current.setEditorWidth(60)
    })

    // 等待防抖的 setTimeout
    vi.runAllTimers()

    expect(window.localStorage.getItem(STORAGE_LAYOUT)).toBe('preview-right')
    expect(window.localStorage.getItem(STORAGE_WIDTH)).toBe('60')
    expect(window.localStorage.getItem(STORAGE_SHOW)).toBe('false')
  })

  it('should update editorWidth while dragging based on mouse position and layout', () => {
    const { result } = renderHook(() => useWorkspaceLayout())

    // 模拟 workspace 的 DOM 尺寸
    const mockElement = {
      getBoundingClientRect: () => ({ left: 0, width: 1000 } as DOMRect),
    } as any

    act(() => {
      result.current.workspaceRef.current = mockElement
    })

    // 默认 layout 为 preview-left
    act(() => {
      result.current.startDragging()
    })

    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }))
    })

    // clientX=300 => 30%，preview-left 时 editorWidth=100-30=70（并被 clamp 到 70）
    expect(result.current.editorWidth).toBe(70)

    // 切换到 preview-right，再拖动一次
    act(() => {
      result.current.setLayout('preview-right')
      result.current.startDragging()
    })

    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }))
    })

    // preview-right 时直接使用 clamped 百分比（30）
    expect(result.current.editorWidth).toBe(30)
  })

  it('should clamp editorWidth and preview width within min/max bounds', () => {
    const { result } = renderHook(() => useWorkspaceLayout())

    // 设置一个过小的编辑器宽度
    act(() => {
      result.current.setEditorWidth(10)
    })

    // gridTemplateColumns 使用的是 clamp 后的宽度：editor 30 / preview 70
    expect(result.current.gridTemplateColumns).toBe('minmax(0, 70%) minmax(0, 30%)')

    // 设置一个过大的编辑器宽度
    act(() => {
      result.current.setEditorWidth(90)
    })

    // clamp 后 editor=70, preview=30
    expect(result.current.gridTemplateColumns).toBe('minmax(0, 30%) minmax(0, 70%)')
  })
})
