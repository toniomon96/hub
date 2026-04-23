/**
 * Returns true if the current local time falls within the configured quiet-hours window.
 * Format: "startHH-endHH" in 24h local time (HUB_TIMEZONE). Wraps midnight when start > end.
 * Empty string → no quiet hours → always returns false.
 */
export function isQuietHour(quietHours: string): boolean {
  if (!quietHours) return false
  const parts = quietHours.split('-')
  if (parts.length !== 2) return false
  const [startH, endH] = parts.map(Number)
  if (isNaN(startH!) || isNaN(endH!)) return false
  const hour = new Date().getHours()
  return startH! > endH!
    ? hour >= startH! || hour < endH! // wraps midnight (e.g. 22-06)
    : hour >= startH! && hour < endH! // same-day window (e.g. 10-18)
}
