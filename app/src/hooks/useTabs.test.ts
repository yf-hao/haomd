import { act, renderHook } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useTabs } from './useTabs'

describe('useTabs', () => {
  it('retains tab identity and unsaved text when moving an active file without changing a background reference', () => {
    const { result } = renderHook(() => useTabs())
    act(() => result.current.createTab({ path: '/index.md', content: '[note](old/n.md)' }))
    const indexId = result.current.activeId!
    act(() => result.current.createTab({ path: '/old/n.md', content: '[image](a.png) unsaved' }))
    const noteId = result.current.activeId!
    const untouched = result.current.tabs.find(tab => tab.id === indexId)
    act(() => result.current.applyFileMove({ oldPath: '/old/n.md', newPath: '/new/n01.md', reconciliationRequired: false,
      documents: [{ path: '/index.md', content: '[note](new/n01.md)', hash: 'i', mtimeMs: 1 },
        { path: '/new/n01.md', content: '[image](../old/a.png)', hash: 'n', mtimeMs: 1 }],
    }, new Map([[indexId, '[note](new/n01.md)'], [noteId, '[image](../old/a.png) unsaved']])) )
    expect(result.current.activeId).toBe(noteId)
    expect(result.current.tabs.find(tab => tab.id === noteId)).toMatchObject({ path: '/new/n01.md', title: 'n01.md', dirty: true })
    expect(result.current.tabs.find(tab => tab.id === indexId)).toBe(untouched)
    expect(result.current.tabs.find(tab => tab.id === indexId)?.content).toBe('[note](old/n.md)')
  })

  it('marks the saved version of its owning tab without clearing newer edits', () => {
    const { result } = renderHook(() => useTabs())
    act(() => { result.current.createTab({ content: 'original', path: '/a.md' }) })
    const firstId = result.current.activeId!
    act(() => {
      result.current.updateTabContent(firstId, 'newer')
      result.current.createTab({ content: 'other', path: '/b.md' })
    })
    act(() => { result.current.markTabSaved(firstId, '/saved.md', 'original') })
    expect(result.current.activeTab?.path).toBe('/b.md')
    expect(result.current.tabs.find(tab => tab.id === firstId)).toMatchObject({ path: '/saved.md', dirty: true, content: 'newer' })
    act(() => { result.current.markTabSaved(firstId, '/saved.md', 'newer') })
    expect(result.current.tabs.find(tab => tab.id === firstId)?.dirty).toBe(false)
  })

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
