import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConfirmDialog } from './ConfirmDialog'

describe('ConfirmDialog', () => {
    it('should render title and message', () => {
        render(
            <ConfirmDialog
                title="Test Title"
                message="Test Message"
                onConfirm={() => { }}
                onCancel={() => { }}
            />
        )

        expect(screen.getByText('Test Title')).toBeDefined()
        expect(screen.getByText('Test Message')).toBeDefined()
    })

    it('should call onConfirm when confirm button is clicked', () => {
        const onConfirm = vi.fn()
        render(
            <ConfirmDialog
                title="Title"
                message="Msg"
                confirmText="Yes"
                onConfirm={onConfirm}
                onCancel={() => { }}
            />
        )

        fireEvent.click(screen.getByText('Yes'))
        expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    it('should call onCancel when cancel button is clicked', () => {
        const onCancel = vi.fn()
        render(
            <ConfirmDialog
                title="Title"
                message="Msg"
                cancelText="No"
                onConfirm={() => { }}
                onCancel={onCancel}
            />
        )

        fireEvent.click(screen.getByText('No'))
        expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('should call onCancel when backdrop is clicked', () => {
        const onCancel = vi.fn()
        const { container } = render(
            <ConfirmDialog
                title="Title"
                message="Msg"
                onConfirm={() => { }}
                onCancel={onCancel}
            />
        )

        // Backdrop is the first div
        const backdrop = container.firstChild as HTMLElement
        fireEvent.click(backdrop)
        expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('should handle Escape key to cancel', () => {
        const onCancel = vi.fn()
        render(
            <ConfirmDialog
                title="Title"
                message="Msg"
                onConfirm={() => { }}
                onCancel={onCancel}
            />
        )

        const dialog = screen.getByRole('button', { name: '确认' }).closest('.modal-confirm')
        if (dialog) {
            fireEvent.keyDown(dialog, { key: 'Escape' })
        }
        expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('should handle Enter key to confirm by default', () => {
        const onConfirm = vi.fn()
        render(
            <ConfirmDialog
                title="Title"
                message="Msg"
                onConfirm={onConfirm}
                onCancel={() => { }}
            />
        )

        // Default active is confirm
        const dialog = screen.getByRole('button', { name: '确认' }).closest('.modal-confirm')
        if (dialog) {
            fireEvent.keyDown(dialog, { key: 'Enter' })
        }
        expect(onConfirm).toHaveBeenCalledTimes(1)
    })
})
