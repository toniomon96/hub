import { describe, expect, it } from 'vitest'
import { isQuietHour } from '../time.js'

describe('isQuietHour', () => {
  it('supports an all-day quiet-hours window', () => {
    expect(isQuietHour('00-24', { now: new Date('2026-05-03T23:30:00Z'), timeZone: 'UTC' })).toBe(
      true,
    )
  })

  it('evaluates the hour in the configured timezone', () => {
    const now = new Date('2026-05-03T23:30:00Z')
    expect(isQuietHour('18-19', { now, timeZone: 'America/Chicago' })).toBe(true)
    expect(isQuietHour('18-19', { now, timeZone: 'UTC' })).toBe(false)
  })

  it('supports windows that wrap midnight', () => {
    expect(isQuietHour('22-06', { now: new Date('2026-05-03T03:30:00Z'), timeZone: 'UTC' })).toBe(
      true,
    )
    expect(isQuietHour('22-06', { now: new Date('2026-05-03T12:30:00Z'), timeZone: 'UTC' })).toBe(
      false,
    )
  })
})
