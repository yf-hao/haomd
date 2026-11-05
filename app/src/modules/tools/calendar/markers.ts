import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../../platform/backendTypes'
import { isTauriEnv } from '../../platform/runtime'

export type CalendarMarker = {
  id: string
  date: string
  title: string
  color: CalendarMarkerColor
  createdAt: string
  updatedAt: string
}

export type CalendarMarkerColor = 'blue' | 'green' | 'orange' | 'purple' | 'none'

const STORAGE_KEY = 'haomd:calendar:markers:v1'
let cachedMarkers: CalendarMarker[] | null = null

export function resetCalendarMarkerCache(): void {
  cachedMarkers = null
}

export async function loadCalendarMarkers(): Promise<CalendarMarker[]> {
  if (cachedMarkers) return [...cachedMarkers]
  const fallback = readLocalMarkers()
  if (isTauriEnv()) {
    try {
      const response = await invoke<BackendResult<CalendarMarker[]>>('load_calendar_markers')
      if ('Ok' in response) {
        const markers = normalizeMarkers(response.Ok.data)
        if (markers.length === 0 && fallback.length > 0) {
          await saveCalendarMarkers(fallback)
          return [...fallback]
        }
        cachedMarkers = markers
        return [...markers]
      }
    } catch {
      // Use browser storage when the native command is unavailable.
    }
  }
  cachedMarkers = fallback
  return [...fallback]
}

export async function saveCalendarMarkers(markers: CalendarMarker[]): Promise<void> {
  const normalized = normalizeMarkers(markers)
  cachedMarkers = normalized
  writeLocalMarkers(normalized)
  if (!isTauriEnv()) return
  try {
    const response = await invoke<BackendResult<null>>('save_calendar_markers', { markers: normalized })
    if ('Err' in response) console.error('[calendar.markers] save failed', response.Err.error)
  } catch (error) {
    console.error('[calendar.markers] save failed', error)
  }
}

export function createCalendarMarker(input: {
  date: string
  title: string
  color: CalendarMarkerColor
}): CalendarMarker {
  const now = new Date().toISOString()
  return {
    id: createId(),
    date: input.date,
    title: input.title.trim(),
    color: input.color,
    createdAt: now,
    updatedAt: now,
  }
}

export function updateCalendarMarker(
  marker: CalendarMarker,
  patch: { title?: string; color?: CalendarMarkerColor },
): CalendarMarker {
  return {
    ...marker,
    title: patch.title?.trim() ?? marker.title,
    color: patch.color ?? marker.color,
    updatedAt: new Date().toISOString(),
  }
}

export function markersForDate(markers: CalendarMarker[], date: string): CalendarMarker[] {
  return markers.filter((marker) => marker.date === date).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

function normalizeMarkers(markers: CalendarMarker[]): CalendarMarker[] {
  return markers.filter(isCalendarMarker).map((marker) => ({
    ...marker,
    title: marker.title.trim(),
    color: isMarkerColor(marker.color) ? marker.color : 'blue',
  })).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
}

function readLocalMarkers(): CalendarMarker[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? normalizeMarkers(parsed) : []
  } catch {
    return []
  }
}

function writeLocalMarkers(markers: CalendarMarker[]): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(markers))
}

function isCalendarMarker(value: unknown): value is CalendarMarker {
  if (!value || typeof value !== 'object') return false
  const marker = value as Partial<CalendarMarker>
  return typeof marker.id === 'string' && typeof marker.date === 'string' &&
    typeof marker.title === 'string' && typeof marker.createdAt === 'string' &&
    typeof marker.updatedAt === 'string'
}

function isMarkerColor(value: unknown): value is CalendarMarkerColor {
  return value === 'blue' || value === 'green' || value === 'orange' || value === 'purple' || value === 'none'
}

function createId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `marker_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
