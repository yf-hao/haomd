// app/src/test-utils/index.ts
import { render } from '@testing-library/react'
import type { RenderOptions } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import React from 'react'

/**
 * Mock Provider 包装器
 * 未来在这里添加需要的 Context Provider，如 ThemeProvider, Router 等
 */
export function createWrapper() {
    return function Wrapper({ children }: { children: ReactNode }) {
        return React.createElement(React.Fragment, null, children)
    }
}

/**
 * 自定义 render 函数，自动包含必要的 Provider
 */
export function renderWithProviders(
    ui: ReactElement,
    options?: Omit<RenderOptions, 'wrapper'>
) {
    const Wrapper = createWrapper()
    return render(ui, { wrapper: Wrapper, ...options })
}

/**
 * Mock 工厂函数：创建模拟的文件数据
 */
export function createMockFilePayload(overrides = {}) {
    return {
        path: '/test/file.md',
        content: '# Test Content',
        displayName: 'file.md',
        ...overrides
    }
}

/**
 * Mock 工厂函数：创建模拟的 Tab 数据
 */
export function createMockTab(overrides = {}) {
    return {
        id: 'tab-1',
        path: '/test/file.md',
        displayName: 'file.md',
        isDirty: false,
        content: '# Test',
        ...overrides
    }
}

// 重导出 testing-library 的常用功能
export * from '@testing-library/react'
export { renderWithProviders as render }
