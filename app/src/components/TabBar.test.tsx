import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TabBar } from './TabBar'
import type { EditorTab } from '../types/tabs'

describe('TabBar', () => {
    const mockTabs: EditorTab[] = [
        { id: '1', title: 'Tab 1', dirty: false },
        { id: '2', title: 'Tab 2', dirty: true }
    ] as any

    it('should render tabs with titles', () => {
        render(
            <TabBar
                tabs={mockTabs}
                activeId="1"
                onTabClick={() => { }}
                onTabClose={() => { }}
            />
        )

        expect(screen.getByText('Tab 1')).toBeDefined()
        const tab2Title = screen.getByText('Tab 2')
        expect(tab2Title).toBeDefined()
        // 脏标记现在使用独立的 dot 元素，而不是直接渲染 "● Tab 2" 文本
        expect(tab2Title.closest('.tab-item')?.querySelector('.tab-dirty-dot')).not.toBeNull()
    })

    it('should mark active tab', () => {
        const { container } = render(
            <TabBar
                tabs={mockTabs}
                activeId="1"
                onTabClick={() => { }}
                onTabClose={() => { }}
            />
        )

        const activeTab = container.querySelector('.tab-item.active')
        expect(activeTab?.textContent).toContain('Tab 1')
    })

    it('should call onTabClick when tab is clicked', () => {
        const onTabClick = vi.fn()
        render(
            <TabBar
                tabs={mockTabs}
                activeId="1"
                onTabClick={onTabClick}
                onTabClose={() => { }}
            />
        )

        fireEvent.click(screen.getByText('Tab 2'))
        expect(onTabClick).toHaveBeenCalledWith('2')
    })

    it('should call onTabClose when close button is clicked and not dirty', () => {
        const onTabClose = vi.fn()
        render(
            <TabBar
                tabs={mockTabs}
                activeId="1"
                onTabClick={() => { }}
                onTabClose={onTabClose}
            />
        )

        const closeBtn = screen.getAllByRole('button')[0] // Close btn for Tab 1
        fireEvent.click(closeBtn)
        expect(onTabClose).toHaveBeenCalledWith('1')
    })

    it('should call onRequestSaveAndClose when dirty tab close is clicked with handler', () => {
        const onRequestSaveAndClose = vi.fn()
        render(
            <TabBar
                tabs={mockTabs}
                activeId="1"
                onTabClick={() => { }}
                onTabClose={() => { }}
                onRequestSaveAndClose={onRequestSaveAndClose}
            />
        )

        const closeBtn = screen.getAllByRole('button')[1] // Close btn for Tab 2 (dirty)
        fireEvent.click(closeBtn)
        expect(onRequestSaveAndClose).toHaveBeenCalledWith('2')
    })

    it('should show window.confirm when dirty tab close is clicked without save handler', () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
        const onTabClose = vi.fn()
        render(
            <TabBar
                tabs={mockTabs}
                activeId="1"
                onTabClick={() => { }}
                onTabClose={onTabClose}
            />
        )

        const closeBtn = screen.getAllByRole('button')[1]
        fireEvent.click(closeBtn)
        expect(confirmSpy).toHaveBeenCalled()
        expect(onTabClose).toHaveBeenCalledWith('2')
    })
})
