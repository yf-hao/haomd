import { useEffect } from 'react'
import {
  getMusicTrackState,
  pauseMusicTrackByAlarm,
  resumeMusicTrack,
} from '../music/musicAudio'
import type { ActiveAlarm } from './useAlarmScheduler'

export function useAlarmMusicPauseSync(activeAlarm: ActiveAlarm | null): void {
  useEffect(() => {
    let cancelled = false

    const syncAlarmMusicState = async () => {
      const state = await getMusicTrackState()
      if (cancelled) return

      if (activeAlarm) {
        if (state?.playing && !state.paused) {
          await pauseMusicTrackByAlarm()
        }
        return
      }

      if (!state?.pausedByAlarm) return
      if (state.paused) {
        await resumeMusicTrack()
      }
    }

    void syncAlarmMusicState()
    const timer = activeAlarm
      ? window.setInterval(() => {
          void syncAlarmMusicState()
        }, 1000)
      : null

    return () => {
      cancelled = true
      if (timer != null) {
        window.clearInterval(timer)
      }
    }
  }, [activeAlarm])
}
