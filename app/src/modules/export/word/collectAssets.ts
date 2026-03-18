import { invoke } from '@tauri-apps/api/core'
import { dirname, resolve } from '@tauri-apps/api/path'
import type { WordAsset, WordDocPayload } from './types'

type BackendBinaryResult = {
  Ok?: { data: number[] }
}

export async function collectWordAssets(options: {
  payload: WordDocPayload
  filePath: string | null
}): Promise<WordDocPayload> {
  const { payload, filePath } = options
  const baseDir = filePath ? await dirname(filePath) : null

  const assets = await Promise.all(payload.assets.map(async (asset) => {
    if (asset.kind !== 'image') return asset
    return await enrichImageAsset(asset, baseDir)
  }))

  return {
    ...payload,
    assets,
  }
}

async function enrichImageAsset(asset: Extract<WordAsset, { kind: 'image' }>, baseDir: string | null): Promise<WordAsset> {
  const sourcePath = await resolveSourcePath(asset.sourcePath, baseDir)
  if (/^(https?:|data:)/i.test(sourcePath)) {
    throw new Error(`Word 导出暂不支持远程图片: ${sourcePath}`)
  }

  const mimeType = asset.mimeType || getMimeType(sourcePath)
  const binary = await invoke<BackendBinaryResult>('read_binary_file', { path: sourcePath, trace_id: null })
  const bytes = binary?.Ok?.data
  if (!bytes?.length) {
    throw new Error(`读取图片失败: ${sourcePath}`)
  }

  const { width, height } = await measureImage(new Uint8Array(bytes), mimeType)
  return {
    ...asset,
    sourcePath,
    mimeType,
    widthPx: asset.widthPx ?? width,
    heightPx: asset.heightPx ?? height,
  }
}

async function resolveSourcePath(input: string, baseDir: string | null): Promise<string> {
  if (!input) return input
  if (/^(https?:|data:)/i.test(input)) return input
  if (!baseDir) return input
  return await resolve(baseDir, input)
}

function getMimeType(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  return 'application/octet-stream'
}

async function measureImage(bytes: Uint8Array, mimeType: string): Promise<{ width: number; height: number }> {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mimeType })
  const url = URL.createObjectURL(blob)
  try {
    const size = await loadImageSize(url)
    return size
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolvePromise, reject) => {
    const image = new Image()
    image.onload = () => resolvePromise({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = reject
    image.src = url
  })
}
