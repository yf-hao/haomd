import type { SessionDigest } from './types'
import {
  loadGlobalMemoryState,
  loadPendingSessionDigests,
  savePendingSessionDigests,
  updateMetaForAutoUpdate,
} from './repo'
import { updateFromSessions } from './service'
import { loadGlobalMemorySettings } from './settingsRepo'

function getTodayKey(): string {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function canTriggerAutoUpdate(options: {
  now: number
  settingsEnabled: boolean
  settingsAutoUpdateEnabled: boolean
  pendingCount: number
  lastGlobalUpdateTime: number | null
  autoUpdateCountToday: number
  autoUpdateDayKey: string | null
}): { allow: boolean; reason?: string; todayKey: string; nextCountToday: number } {
  const { now, settingsEnabled, settingsAutoUpdateEnabled, pendingCount, lastGlobalUpdateTime, autoUpdateCountToday, autoUpdateDayKey } = options
  const cfg = loadGlobalMemorySettings()

  const todayKey = getTodayKey()
  const isSameDay = autoUpdateDayKey === todayKey
  const currentCount = isSameDay ? autoUpdateCountToday : 0

  if (!settingsEnabled) {
    return { allow: false, reason: 'global memory disabled', todayKey, nextCountToday: currentCount }
  }

  if (!settingsAutoUpdateEnabled) {
    return { allow: false, reason: 'auto update disabled', todayKey, nextCountToday: currentCount }
  }

  if (pendingCount <= 0) {
    return { allow: false, reason: 'no pending digests', todayKey, nextCountToday: currentCount }
  }

  if (currentCount >= cfg.maxAutoUpdatesPerDay) {
    return { allow: false, reason: 'daily auto update limit reached', todayKey, nextCountToday: currentCount }
  }

  if (pendingCount < cfg.minDigests) {
    // 如果 pending 未达到数量阈值，还可以依赖时间间隔触发
    if (lastGlobalUpdateTime != null) {
      const hoursSinceLast = (now - lastGlobalUpdateTime) / (1000 * 60 * 60)
      if (hoursSinceLast < cfg.minIntervalHours) {
        return { allow: false, reason: 'not enough digests and interval not reached', todayKey, nextCountToday: currentCount }
      }
    }
  } else if (lastGlobalUpdateTime != null) {
    // 数量达到阈值，但如果离上次更新特别近，也可以视为太频繁
    const hoursSinceLast = (now - lastGlobalUpdateTime) / (1000 * 60 * 60)
    if (hoursSinceLast < 0.1) {
      // 小于 6 分钟时认为过于频繁，避免某些极端情况疯狂触发
      return { allow: false, reason: 'too frequent auto update', todayKey, nextCountToday: currentCount }
    }
  }

  return { allow: true, todayKey, nextCountToday: currentCount + 1 }
}

function pickBatchFromPending(pending: SessionDigest[]): { batch: SessionDigest[]; rest: SessionDigest[] } {
  if (!pending.length) return { batch: [], rest: [] }
  const cfg = loadGlobalMemorySettings()

  if (pending.length <= cfg.maxDigestsPerBatch) {
    return { batch: pending, rest: [] }
  }

  const batch = pending.slice(0, cfg.maxDigestsPerBatch)
  const rest = pending.slice(cfg.maxDigestsPerBatch)
  return { batch, rest }
}

/**
 * 尝试执行一次全局记忆自动更新。
 *
 * - 读取当前 GlobalMemoryState 与 pending digests；
 * - 根据 DEFAULT_GLOBAL_MEMORY_SETTINGS 判断是否满足触发条件；
 * - 若满足，从队列中取出一批 digests 调用 updateFromSessions，并更新队列与 meta 信息；
 * - 若不满足，仅返回 false，不做任何修改。
 */
export async function runGlobalMemoryAutoUpdateOnce(options?: {
  enabled?: boolean
  autoUpdateEnabled?: boolean
}): Promise<boolean> {
  const state = loadGlobalMemoryState()
  const pending = loadPendingSessionDigests()
  const now = Date.now()
  const settings = loadGlobalMemorySettings()

  const settingsEnabled = options?.enabled ?? settings.enabled
  const settingsAutoUpdateEnabled = options?.autoUpdateEnabled ?? settings.autoUpdateEnabled

  const can = canTriggerAutoUpdate({
    now,
    settingsEnabled,
    settingsAutoUpdateEnabled,
    pendingCount: pending.length,
    lastGlobalUpdateTime: state.lastGlobalUpdateTime,
    autoUpdateCountToday: state.autoUpdateCountToday,
    autoUpdateDayKey: state.autoUpdateDayKey,
  })

  if (!can.allow) {
    // 可按需调试：console.debug('[GlobalMemoryAutoUpdate] skip:', can.reason)
    return false
  }

  const { batch, rest } = pickBatchFromPending(pending)
  if (!batch.length) {
    return false
  }

  try {
    await updateFromSessions(batch)

    // 更新队列：移除已处理的 digests
    savePendingSessionDigests(rest)

    const lastGlobalUpdateTime = Date.now()
    const autoUpdateDayKey = can.todayKey
    const autoUpdateCountToday = can.nextCountToday

    updateMetaForAutoUpdate({ lastGlobalUpdateTime, autoUpdateCountToday, autoUpdateDayKey })

    return true
  } catch (e) {
    console.error('[GlobalMemoryAutoUpdate] runGlobalMemoryAutoUpdateOnce failed', e)
    return false
  }
}

/**
 * 手动触发一次全局记忆更新。
 *
 * - 不受数量阈值与每日次数限制，只要队列中有 pending digests 就会执行；
 * - 更新完成后会清空已处理的队列，并刷新 lastGlobalUpdateTime；
 * - 若当前没有 pending digests，则返回 false。
 */
export async function runGlobalMemoryUpdateNow(): Promise<boolean> {
  const state = loadGlobalMemoryState()
  const pending = loadPendingSessionDigests()

  if (!pending.length) {
    return false
  }

  try {
    await updateFromSessions(pending)
    // 清空已处理队列
    savePendingSessionDigests([])

    const now = Date.now()
    const autoUpdateDayKey = state.autoUpdateDayKey ?? getTodayKey()
    const autoUpdateCountToday = state.autoUpdateCountToday

    updateMetaForAutoUpdate({
      lastGlobalUpdateTime: now,
      autoUpdateDayKey,
      autoUpdateCountToday,
    })

    return true
  } catch (e) {
    console.error('[GlobalMemoryAutoUpdate] runGlobalMemoryUpdateNow failed', e)
    return false
  }
}

/**
 * 创建一个简单的基于 setInterval 的自动调度器。
 *
 * - intervalMs：检查间隔（默认 10 分钟）；
 * - enabled / autoUpdateEnabled：用于与 UI 开关或配置对接；
 * - 返回一个 handle，供调用方在组件卸载或应用关闭时取消。
 */
export function createGlobalMemoryAutoUpdateScheduler(options?: {
  intervalMs?: number
  enabled?: boolean
  autoUpdateEnabled?: boolean
}): { start: () => void; stop: () => void } {
  const intervalMs = options?.intervalMs ?? 10 * 60 * 1000
  const enabled = options?.enabled ?? true
  const autoUpdateEnabled = options?.autoUpdateEnabled ?? true

  let timer: ReturnType<typeof setInterval> | null = null

  const start = () => {
    if (timer || !enabled) return
    timer = setInterval(() => {
      void runGlobalMemoryAutoUpdateOnce({ enabled, autoUpdateEnabled })
    }, intervalMs)
  }

  const stop = () => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  return { start, stop }
}
