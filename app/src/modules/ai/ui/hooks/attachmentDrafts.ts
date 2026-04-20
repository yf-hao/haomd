import type { UploadedFileRef } from '../../domain/types'

export function mergePendingAttachments(
  restored: UploadedFileRef[],
  current: UploadedFileRef[],
): UploadedFileRef[] {
  if (restored.length === 0) return current
  if (current.length === 0) return restored

  const merged: UploadedFileRef[] = []
  const seen = new Set<string>()

  for (const attachment of [...restored, ...current]) {
    if (seen.has(attachment.id)) continue
    seen.add(attachment.id)
    merged.push(attachment)
  }

  return merged
}
