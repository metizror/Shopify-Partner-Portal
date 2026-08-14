// Every date the dashboard renders — in the UI and in outgoing email — goes
// through here, so one setting moves all of them.
//
// This used to be `Asia/Kolkata` written out in nine files, with the string
// " IST" glued onto the end of the result. TZ_DISPLAY was documented in
// .env.example but read by nothing, so setting it appeared to do nothing.
//
// TZ_DISPLAY is readable in the browser as well as on the server: next.config.js
// maps it into the client bundle. That is safe precisely because a timezone name
// is not a secret — do not extend that mapping to anything that is.

/**
 * Neutral English formatting. Deliberately not configurable: the zone is what
 * changes what a date *means* to a reader, while the locale only shuffles the
 * order of the parts, and one more knob to explain is not worth that.
 */
const LOCALE = 'en-GB'

const FALLBACK_TZ = 'UTC'

function resolveTz(): string {
  const configured = (process.env.TZ_DISPLAY || '').trim()
  if (!configured) return FALLBACK_TZ
  try {
    // Throws RangeError on an unknown zone. Checking once here turns a typo into
    // a startup warning instead of an exception thrown from inside a table cell.
    new Intl.DateTimeFormat(LOCALE, { timeZone: configured }).format(new Date(0))
    return configured
  } catch {
    console.warn(`[tz] TZ_DISPLAY="${configured}" is not a known IANA timezone; falling back to ${FALLBACK_TZ}.`)
    return FALLBACK_TZ
  }
}

/** IANA zone every displayed date is rendered in. `UTC` unless TZ_DISPLAY is set. */
export const DISPLAY_TZ = resolveTz()

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function make(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: DISPLAY_TZ, ...options })
}

const FULL = make({
  day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: true,
  // Replaces the hardcoded " IST" suffix. Intl renders the correct label for
  // whichever zone is configured — "UTC", "GMT+5:30", "EDT" — and gets daylight
  // saving right, which a pasted-on string never could.
  timeZoneName: 'short',
})

const SHORT = make({ dateStyle: 'medium', timeStyle: 'short' })

const DAY_TIME = make({
  day: '2-digit', month: 'short',
  hour: '2-digit', minute: '2-digit', hour12: true,
})

/** Full date, time and zone label — for email bodies and anywhere unambiguous wins. */
export function formatDateTime(value: Date | string | number | null | undefined): string {
  const d = toDate(value)
  return d ? FULL.format(d) : ''
}

/** Date and time, no zone label — for dense tables where the zone is understood. */
export function formatShort(value: Date | string | number | null | undefined): string {
  const d = toDate(value)
  return d ? SHORT.format(d) : ''
}

/** Day, month and time, no year — for things happening within days either way. */
export function formatDayTime(value: Date | string | number | null | undefined): string {
  const d = toDate(value)
  return d ? DAY_TIME.format(d) : ''
}

/**
 * Calendar day as YYYY-MM-DD in the display zone, for bucketing trend charts.
 *
 * The previous version added 5.5 hours to a UTC timestamp and sliced the ISO
 * string, which silently assumed India and would land on the wrong day for any
 * zone observing daylight saving.
 */
const DAY_PARTS = make({ year: 'numeric', month: '2-digit', day: '2-digit' })

export function calendarDay(d: Date): string {
  const p = Object.fromEntries(DAY_PARTS.formatToParts(d).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

/** Today's date in the display zone, as YYYY-MM-DD. */
export function today(): string {
  return calendarDay(new Date())
}

/**
 * How far the display zone is ahead of UTC at a given instant, in ms.
 *
 * Read from Intl rather than stored as a constant so it is right on both sides
 * of a daylight-saving change — the whole reason a fixed `+ 5.5 hours` had to go.
 */
function offsetMs(at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: DISPLAY_TZ, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(at).map((p) => [p.type, p.value])
  )
  const asIfUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
  )
  return asIfUtc - at.getTime()
}

/**
 * The UTC instant of a wall-clock time on a YYYY-MM-DD day in the display zone.
 *
 * Two passes: the naive guess can land on the far side of a DST boundary and so
 * sample the wrong offset; re-sampling at the corrected instant settles it.
 *
 * A wall-clock time that does not exist (the hour skipped by a spring-forward)
 * resolves to the instant one hour earlier rather than throwing — a scheduled
 * 02:30 job runs at 01:30 that one morning instead of being lost.
 */
export function zonedInstant(day: string, hour = 0, minute = 0): Date {
  const [y, m, d] = day.split('-').map(Number)
  const naive = Date.UTC(y, m - 1, d, hour, minute, 0, 0)
  const once = new Date(naive - offsetMs(new Date(naive)))
  return new Date(naive - offsetMs(once))
}

/** Shift a YYYY-MM-DD day string by whole calendar days. Pure calendar maths — no zone involved. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const shifted = new Date(Date.UTC(y, m - 1, d + n))
  return shifted.toISOString().slice(0, 10)
}

/** Day of week for a YYYY-MM-DD day string, 0 = Sunday. */
export function weekdayOf(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/**
 * `[start, end)` UTC instants bounding a calendar day in the display zone, for
 * querying timestamp columns. `end` is the next day's start rather than start +
 * 24h, so the 23- and 25-hour days around a DST switch stay whole.
 */
export function dayBounds(day: string): { start: Date; end: Date } {
  return { start: zonedInstant(day), end: zonedInstant(addDays(day, 1)) }
}
