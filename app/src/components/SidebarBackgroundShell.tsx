import type { CSSProperties, ComponentPropsWithoutRef, ElementType, ReactNode } from 'react'
import { useThemeContext } from '../modules/theme/ThemeContext'
import {
  buildBackgroundImageVars,
  resolveManagedBackgroundImageUrl,
} from '../modules/theme/backgroundImageRuntime'

type SidebarBackgroundShellProps = {
  as?: ElementType
  className: string
  style?: CSSProperties
  children: ReactNode
} & Omit<ComponentPropsWithoutRef<'div'>, 'className' | 'style' | 'children'>

export function SidebarBackgroundShell({
  as: Component = 'div',
  className,
  style,
  children,
  ...rest
}: SidebarBackgroundShellProps) {
  const { themeSettings } = useThemeContext()
  const sidebarBackground = themeSettings.sidebarBackground
  const sidebarBackgroundUrl = resolveManagedBackgroundImageUrl(sidebarBackground?.path)
  const backgroundStyle = buildBackgroundImageVars(sidebarBackground, { maxOpacity: 0.4 })
  const fitClass = sidebarBackground?.enabled
    ? sidebarBackground.size === 'contain'
      ? 'sidebar-panel-bg-fit-contain'
      : sidebarBackground.size === 'height-fill'
        ? 'sidebar-panel-bg-fit-height-fill'
        : sidebarBackground.size === 'width-fill'
          ? 'sidebar-panel-bg-fit-width-fill'
          : sidebarBackground.size === 'auto'
            ? 'sidebar-panel-bg-fit-auto'
            : ''
    : ''
  const hasSidebarBackground = Boolean(sidebarBackground?.enabled && sidebarBackgroundUrl)

  return (
    <Component
      className={`${className} sidebar-panel-shell ${hasSidebarBackground ? 'has-sidebar-background' : ''} ${fitClass}`.trim()}
      style={{ ...style, ...backgroundStyle }}
      {...rest}
    >
      {hasSidebarBackground ? (
        <>
          <img
            className="sidebar-panel-background"
            src={sidebarBackgroundUrl ?? ''}
            alt=""
            aria-hidden="true"
          />
          <div className="sidebar-panel-background-overlay" aria-hidden="true" />
        </>
      ) : null}
      <div className="sidebar-panel-content">
        {children}
      </div>
    </Component>
  )
}
