import type { FC, ReactNode } from 'react'

interface FieldGroupProps {
    label: string
    children: ReactNode
    className?: string
    inline?: boolean
}

export const FieldGroup: FC<FieldGroupProps> = ({
    label,
    children,
    className = '',
    inline = false
}) => {
    return (
        <div className={`field-group ${inline ? 'inline' : ''} ${className}`}>
            <label className="field-label">{label}</label>
            {children}
        </div>
    )
}
