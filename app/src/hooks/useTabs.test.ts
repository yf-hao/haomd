import { act, renderHook } from '@testing-library/react'
import { useRef } from 'react'
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

  it('closes the active tab and activates the previous tab', () => {
    const onBeforeActiveTabChange = vi.fn()
    const { result } = renderHook(() => useTabs({ onBeforeActiveTabChange }))

    act(() => {
      result.current.createTab({ title: 'first' })
      result.current.createTab({ title: 'second' })
      result.current.createTab({ title: 'third' })
    })
    onBeforeActiveTabChange.mockClear()

    const activeTabId = result.current.tabs[2].id
    const previousTabId = result.current.tabs[1].id

    act(() => {
      result.current.closeTab(activeTabId)
    })

    expect(result.current.tabs.map((tab) => tab.title)).toEqual(['first', 'second'])
    expect(result.current.activeId).toBe(previousTabId)
    expect(onBeforeActiveTabChange).toHaveBeenCalledWith(previousTabId)
  })

  it('does not invoke the transition callback while React evaluates the tab state update', () => {
    const { result } = renderHook(() => {
      const tabs = useTabs({
        onBeforeActiveTabChange: (nextTabId) => {
          transitionTarget.current = nextTabId
        },
      })
      const transitionTarget = useRef<string | null>(null)

      return { ...tabs, transitionTarget }
    })

    act(() => {
      result.current.createTab({ title: 'first' })
      result.current.createTab({ title: 'second' })
    })

    const activeTabId = result.current.tabs[1].id
    const previousTabId = result.current.tabs[0].id

    act(() => {
      result.current.closeTab(activeTabId)
    })

    expect(result.current.activeId).toBe(previousTabId)
    expect(result.current.transitionTarget.current).toBe(previousTabId)
  })

  it('wraps to the last remaining tab when closing the first active tab', () => {
    const onBeforeActiveTabChange = vi.fn()
    const { result } = renderHook(() => useTabs({ onBeforeActiveTabChange }))

    act(() => {
      result.current.createTab({ title: 'first' })
      result.current.createTab({ title: 'second' })
      result.current.createTab({ title: 'third' })
    })

    const firstTabId = result.current.tabs[0].id
    const lastTabId = result.current.tabs[2].id
    act(() => {
      result.current.setActiveTab(firstTabId)
    })
    onBeforeActiveTabChange.mockClear()

    act(() => {
      result.current.closeTab(firstTabId)
    })

    expect(result.current.tabs.map((tab) => tab.title)).toEqual(['second', 'third'])
    expect(result.current.activeId).toBe(lastTabId)
    expect(onBeforeActiveTabChange).toHaveBeenCalledWith(lastTabId)
  })

  it('clears the active tab when closing the last remaining tab', () => {
    const onBeforeActiveTabChange = vi.fn()
    const { result } = renderHook(() => useTabs({ onBeforeActiveTabChange }))

    act(() => {
      result.current.createTab({ title: 'only tab' })
    })

    act(() => {
      result.current.closeTab(result.current.tabs[0].id)
    })

    expect(result.current.tabs).toEqual([])
    expect(result.current.activeId).toBeNull()
    expect(onBeforeActiveTabChange).toHaveBeenCalledWith(null)
  })
})
