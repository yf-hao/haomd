export function shouldIgnoreSelectionChangeFromEditableOutsideRoot(
  root: HTMLElement | null,
  activeElement: Element | null,
) {
  if (!root || !(activeElement instanceof HTMLElement)) return false
  if (root.contains(activeElement)) return false
  if (activeElement.isContentEditable) return true
  const tag = activeElement.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
