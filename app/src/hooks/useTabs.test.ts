import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useTabs } from './useTabs'

describe('useTabs', () => {
  it('runs the transition hook before creating an active tab', () => {
    const onBeforeActiveTabChange = vi.fn()
    const { result } = renderHook(() => useTabs({ onBeforeActiveTabChange }))

    act(() => {
      result.current.createTab({ content: 'new document' })
    })

    expect(onBeforeActiveTabChange).toHaveBeenCalledWith(result.current.activeId)
    expect(result.current.activeTab?.content).toBe('new document')
  })

  it('runs the transition hook before selecting another tab', () => {
    const onBeforeActiveTabChange = vi.fn()
    const { result } = renderHook(() => useTabs({ onBeforeActiveTabChange }))

    act(() => {
      result.current.createTab({ title: 'first' })
      result.current.createTab({ title: 'second' })
    })
    onBeforeActiveTabChange.mockClear()

    act(() => {
      result.current.setActiveTab(result.current.tabs[0].id)
    })

    expect(onBeforeActiveTabChange).toHaveBeenCalledWith(result.current.tabs[0].id)
    expect(result.current.activeId).toBe(result.current.tabs[0].id)
  })
})
