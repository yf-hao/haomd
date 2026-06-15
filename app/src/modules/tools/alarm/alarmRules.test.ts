import { describe, expect, it } from 'vitest'
import { alarmRulesForDate, isAlarmRuleDue, toDateKey } from './alarmRules'
import { createRepeatAlarmRule, createSingleAlarmRule } from './alarmStorage'

describe('alarm rules', () => {
  it('matches single alarms only on the selected date and minute', () => {
    const rule = createSingleAlarmRule({
      title: 'Morning alarm',
      date: '2026-06-15',
      time: '07:30',
    })

    expect(isAlarmRuleDue(rule, new Date('2026-06-15T07:30:10'))).toBe(true)
    expect(isAlarmRuleDue(rule, new Date('2026-06-15T07:31:00'))).toBe(false)
    expect(isAlarmRuleDue(rule, new Date('2026-06-16T07:30:00'))).toBe(false)
  })

  it('matches weekly and biweekly alarms by weekday and interval', () => {
    const weekly = createRepeatAlarmRule({
      title: 'Weekly sync',
      startDate: '2026-06-01',
      time: '10:00',
      weekdays: [1],
      frequency: 'weekly',
    })
    const biweekly = createRepeatAlarmRule({
      title: 'Biweekly sync',
      startDate: '2026-06-01',
      time: '10:00',
      weekdays: [1],
      frequency: 'biweekly',
    })

    expect(isAlarmRuleDue(weekly, new Date('2026-06-08T10:00:00'))).toBe(true)
    expect(isAlarmRuleDue(weekly, new Date('2026-06-08T10:01:00'))).toBe(false)
    expect(isAlarmRuleDue(biweekly, new Date('2026-06-08T10:00:00'))).toBe(false)
    expect(isAlarmRuleDue(biweekly, new Date('2026-06-15T10:00:00'))).toBe(true)
  })

  it('filters alarm rules for a given date', () => {
    const rules = [
      createSingleAlarmRule({ title: 'One-off', date: '2026-06-15', time: '08:00' }),
      createRepeatAlarmRule({
        title: 'Weekly',
        startDate: '2026-06-01',
        time: '08:00',
        weekdays: [1],
        frequency: 'weekly',
      }),
    ]

    expect(alarmRulesForDate(rules, toDateKey(new Date('2026-06-15T00:00:00')))).toHaveLength(2)
    expect(alarmRulesForDate(rules, toDateKey(new Date('2026-06-16T00:00:00')))).toHaveLength(0)
  })
})
