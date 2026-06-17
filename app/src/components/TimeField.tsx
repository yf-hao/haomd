import { forwardRef, type ChangeEvent, type FocusEvent, type InputHTMLAttributes, type PointerEvent } from 'react'
import { formatTimeDraft, normalizeTimeDraft } from '../modules/time/timeInput'

type TimeFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'onBlur' | 'onFocus' | 'onPointerDown' | 'inputMode' | 'maxLength' | 'autoComplete'
> & {
  value: string
  onValueChange: (value: string) => void
  onValueBlur?: (value: string) => void
  onFocus?: (event: FocusEvent<HTMLInputElement>) => void
}

export const TimeField = forwardRef<HTMLInputElement, TimeFieldProps>(function TimeField(
  { value, onValueChange, onValueBlur, className, onFocus, ...rest },
  ref,
) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onValueChange(formatTimeDraft(event.target.value))
  }

  function handleBlur(event: FocusEvent<HTMLInputElement>) {
    const nextValue = normalizeTimeDraft(event.target.value)
    onValueChange(nextValue)
    onValueBlur?.(nextValue)
  }

  function handleFocus(event: FocusEvent<HTMLInputElement>) {
    event.currentTarget.select()
    onFocus?.(event)
  }

  function handlePointerDown(event: PointerEvent<HTMLInputElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.select()
  }

  return (
    <input
      ref={ref}
      className={className}
      type="text"
      inputMode="numeric"
      maxLength={5}
      autoComplete="off"
      value={value}
      onChange={handleChange}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onPointerDown={handlePointerDown}
      {...rest}
    />
  )
})
