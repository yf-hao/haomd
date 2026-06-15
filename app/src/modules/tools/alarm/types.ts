export type AlarmRuleType = 'single' | 'repeat'
export type AlarmFrequency = 'weekly' | 'biweekly'

export type AlarmRule = {
  id: string
  title: string
  type: AlarmRuleType
  date: string | null
  time: string
  startDate: string | null
  frequency: AlarmFrequency | null
  weekdays: number[]
  intervalWeeks: number | null
  until: string | null
  enabled: boolean
  soundFile: string | null
  createdAt: string
  updatedAt: string
}

export const DEFAULT_ALARM_SOUND_FILE: string | null = null

