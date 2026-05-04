interface QuietHourOptions {
  timeZone?: string
  now?: Date
}

/**
 * Returns true if the current local time falls within the configured quiet-hours window.
 * Format: "startHH-endHH" in 24h local time (HUB_TIMEZONE). Wraps midnight when start > end.
 * Empty string -> no quiet hours -> always returns false.
 */
export function isQuietHour(quietHours: string, opts: QuietHourOptions = {}): boolean {
  if (!quietHours) return false
  const parts = quietHours.split('-')
  if (parts.length !== 2) return false
  const [startH, endH] = parts.map(Number)
  if (isNaN(startH!) || isNaN(endH!)) return false
  if (startH! < 0 || startH! > 23 || endH! < 0 || endH! > 24) return false
  const hour = getHour(opts.now ?? new Date(), opts.timeZone)
  return startH! > endH!
    ? hour >= startH! || hour < endH! // wraps midnight (e.g. 22-06)
    : hour >= startH! && hour < endH! // same-day window (e.g. 10-18)
}

function getHour(now: Date, timeZone?: string): number {
  if (!timeZone) return now.getHours()
  try {
    const hourPart = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .find((part) => part.type === 'hour')?.value
    const hour = Number(hourPart)
    return Number.isInteger(hour) ? hour : now.getHours()
  } catch {
    return now.getHours()
  }
}
