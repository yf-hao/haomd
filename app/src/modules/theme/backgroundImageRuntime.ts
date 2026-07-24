import type { CSSProperties } from 'react'
import type { ThemeBackgroundSettings, ThemeSettings } from '../settings/editorSettings'
import { getBuiltinBackgroundPresetUrl } from './backgroundPresets'
import { convertFileSrc } from '@tauri-apps/api/core'

const backgroundImageUrlCache = new Map<string, string>()

export function resolveManagedBackgroundImageUrl(path: string | null | undefined): string | null {
  if (!path) return null
  const normalizedPath = path.trim()
  if (!normalizedPath) return null
  if (normalizedPath.startsWith('builtin:')) {
    return getBuiltinBackgroundPresetUrl(normalizedPath.slice('builtin:'.length))
  }
  if (/^(data:|blob:|https?:)/i.test(normalizedPath)) return normalizedPath

  const cacheKey = `unix|${normalizedPath}`
  const cached = backgroundImageUrlCache.get(cacheKey)
  if (cached) return cached

  const finalUrl = convertFileSrc(normalizedPath.replace(/\\/g, '/'), 'haomd')
  backgroundImageUrlCache.set(cacheKey, finalUrl)
  return finalUrl
}

export function buildBackgroundImageVars(
  background: ThemeBackgroundSettings | null | undefined,
  options?: {
    maxOpacity?: number
  },
): CSSProperties | undefined {
  if (!background?.enabled || !background.path) return undefined

  return {
    '--background-image-opacity': `${Math.min(Math.max(background.opacity, 0), options?.maxOpacity ?? 1)}`,
    '--background-image-overlay-opacity': `${Math.min(Math.max(background.overlayOpacity ?? 0, 0), 1)}`,
    '--background-image-blur': `${Math.min(Math.max(background.blurPx, 0), 24)}px`,
    '--background-image-brightness': `${Math.min(Math.max(background.brightness, 0), 200)}%`,
    '--background-image-position-x': `${Math.min(Math.max(background.positionX, 0), 100)}%`,
    '--background-image-position-y': `${Math.min(Math.max(background.positionY, 0), 100)}%`,
  } as CSSProperties
}

export function resolveAiChatEffectiveBackground(
  themeSettings: ThemeSettings | null | undefined,
): ThemeBackgroundSettings | undefined {
  const aiChatBackground = themeSettings?.aiChatBackground
  if (aiChatBackground?.enabled && aiChatBackground.path) {
    return aiChatBackground
  }

  const workspaceBackground = themeSettings?.workspaceBackground
  if (workspaceBackground?.enabled && workspaceBackground.path) {
    return workspaceBackground
  }

  return undefined
}
