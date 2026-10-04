import type { AutomationSchedule } from 'ling-desktop/runtime'
const minute = 60_000,
  day = 86_400_000
const formatters = new Map<string, Intl.DateTimeFormat>()
function parts(at: number, timeZone: string) {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    if (formatters.size >= 64) formatters.clear()
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    formatters.set(timeZone, formatter)
  }
  const p = Object.fromEntries(formatter.formatToParts(at).map((p) => [p.type, p.value]))
  return [Number(p.year), Number(p.month), Number(p.day), Number(p.hour), Number(p.minute)] as const
}
/** Resolve wall time in an IANA zone; skip nonexistent DST times and choose the first overlap. */
export function wallTime(date: readonly number[], time: string, zone: string): number | null {
  const [h, m] = time.split(':').map(Number),
    target = Date.UTC(date[0]!, date[1]! - 1, date[2]!, h, m)
  let candidate = target
  for (let n = 0; n < 4; n++) {
    const p = parts(candidate, zone)
    const offset = Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4]) - candidate
    candidate = target - offset
  }
  const matches = (at: number) => {
    const p = parts(at, zone)
    return p[0] === date[0] && p[1] === date[1] && p[2] === date[2] && p[3] === h && p[4] === m
  }
  if (!matches(candidate)) return null
  // Timezone transitions can be half-hour, hour, or two-hour shifts.
  for (let shift = 180; shift > 0; shift--)
    if (matches(candidate - shift * minute)) return candidate - shift * minute
  return candidate
}
export function nextOccurrence(
  schedule: AutomationSchedule,
  after: number,
  anchor: number,
  expiry: number | null = null,
): number | null {
  let value: number | null = null
  if (schedule.kind === 'once') value = schedule.at > after ? schedule.at : null
  else if (schedule.kind === 'interval') {
    const every = schedule.minutes * minute
    value = anchor + Math.max(1, Math.floor((after - anchor) / every) + 1) * every
  } else {
    const p = parts(after, schedule.timeZone),
      date = Date.UTC(p[0], p[1] - 1, p[2])
    for (let n = 0; n < 370; n++) {
      const d = new Date(date + n * day)
      if (schedule.kind === 'weekly' && !schedule.weekdays.includes(d.getUTCDay())) continue
      const at = wallTime(
        [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()],
        schedule.time,
        schedule.timeZone,
      )
      if (at !== null && at > after) {
        value = at
        break
      }
    }
  }
  return value !== null && (expiry === null || value <= expiry) ? value : null
}
