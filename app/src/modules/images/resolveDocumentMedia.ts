import { convertFileSrc } from '@tauri-apps/api/core'
import { resolveLocalResource } from '../markdown/references/resourcePath'

export function resolveDocumentMedia(src: string, filePath?: string | null): string {
  if (!filePath) return src
  try {
    const local = resolveLocalResource(src, filePath)
    return local ? convertFileSrc(local.path.replace(/\\/g, '/'), 'haomd') + local.search + local.hash : src
  } catch { return src }
}
