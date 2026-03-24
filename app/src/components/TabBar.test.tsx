import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { TabBar } from './TabBar'
import type { EditorTab } from '../types/tabs'

class ResizeObserverMock {
    observe() {}
    disconnect() {}
    unobserve() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverMock)

describe('TabBar', () => {
    const mockTabs: EditorTab[] = [
        { id: '1', title: 'Tab 1', dirty: false },
        { id: '2', title: 'Tab 2', dirty: true }
    ] as any

    it('should render tabs with titles', () => {
        const { container } = render(
            <TabBar
                tabs={mockTabs}
                activeId="1"
                onTabClick={() => { }}
                onTabClose={() => { }}
            />
        )

        const list = container.querySelector('.tab-bar-list') as HTMLElement
        expect(within(list).getByText('Tab 1')).toBeDefined()
        const tab2Title = within(list).getByText('Tab 2')
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
        const { container } = render(
            <TabBar
                tabs={mockTabs}
                activeId="1"
                onTabClick={onTabClick}
                onTabClose={() => { }}
            />
        )

        const list = container.querySelector('.tab-bar-list') as HTMLElement
        fireEvent.click(within(list).getByText('Tab 2'))
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

    it('should show overflow menu for hidden tabs', () => {
        const onTabClick = vi.fn()
        const tabs = [
            { id: '1', title: 'Tab 1', dirty: false },
            { id: '2', title: 'Tab 2', dirty: false },
            { id: '3', title: 'Tab 3', dirty: false },
        ] as any

        const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            const el = this as HTMLElement
            if (el.classList.contains('tab-bar')) {
                return { width: 220, height: 28, top: 0, left: 0, right: 220, bottom: 28, x: 0, y: 0, toJSON() {} } as DOMRect
            }
            if (el.classList.contains('tab-item')) {
                return { width: 96, height: 24, top: 0, left: 0, right: 96, bottom: 24, x: 0, y: 0, toJSON() {} } as DOMRect
            }
            return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} } as DOMRect
        })

        render(
            <TabBar
                tabs={tabs}
                activeId="3"
                onTabClick={onTabClick}
                onTabClose={() => { }}
            />
        )

        const overflowButton = screen.getByRole('button', { name: 'Show hidden tabs' })
        fireEvent.click(overflowButton)
        fireEvent.click(screen.getByRole('button', { name: 'Tab 1' }))
        expect(onTabClick).toHaveBeenCalledWith('1')
        rectSpy.mockRestore()
    })
})
