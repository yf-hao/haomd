import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  fullWidth?: boolean
  loading?: boolean
  icon?: ReactNode
  iconRight?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    fullWidth = false,
    loading = false,
    icon,
    iconRight,
    children,
    disabled,
    type = 'button',
    className = '',
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading

  const classes = [
    'modal-btn',
    variant,
    fullWidth ? 'modal-btn--block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...rest}
    >
      {icon && <span className="btn-icon btn-icon-left">{icon}</span>}
      {children && <span className="btn-label">{children}</span>}
      {iconRight && <span className="btn-icon btn-icon-right">{iconRight}</span>}
    </button>
  )
})
