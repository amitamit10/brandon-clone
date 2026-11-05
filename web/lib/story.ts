import type { ChatExtras, ChatStats } from '../../src/shared/types'

/**
 * Pure derivations for the 7 story cards. Kept apart from the markup so the numbers can be tested.
 * Timestamps are wall-clock values stored as UTC ms, so every date here is formatted in UTC.
 */

const DAY_MS = 86_400_000

export function formatDay(ts: number): string {
  return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(ts),
  )
}

export function formatIsoDay(iso: string): string {
  const ts = Date.parse(`${iso}T00:00:00Z`)
  return Number.isNaN(ts) ? iso : formatDay(ts)
}

export function formatClock(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

export function percentOf(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}

// ---- Card 1: calendar heatmap ----

export interface CalendarCell {
  date: string
  count: number
  /** 0 for no messages, then 1 to 4 for brightness */
  level: 0 | 1 | 2 | 3 | 4
}

export interface CalendarMonth {
  key: string
  label: string
  /** 31 slots; null past the end of the month */
  cells: (CalendarCell | null)[]
}

export interface CalendarGrid {
  months: CalendarMonth[]
  activeDays: number
  maxCount: number
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** One row per month from the first to the last month of the chat, one column per day. */
export function calendarGrid(extras: ChatExtras, firstTs: number, lastTs: number): CalendarGrid {
  const counts = new Map<string, number>()
  let maxCount = 0
  for (const day of extras.calendar) {
    counts.set(day.date, day.count)
    if (day.count > maxCount) maxCount = day.count
  }
  const start = new Date(firstTs)
  const end = new Date(lastTs)
  const months: CalendarMonth[] = []
  let y = start.getUTCFullYear()
  let m = start.getUTCMonth()
  const endKey = end.getUTCFullYear() * 12 + end.getUTCMonth()
  while (y * 12 + m <= endKey) {
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
    const cells: (CalendarCell | null)[] = []
    for (let d = 1; d <= 31; d++) {
      if (d > daysInMonth) {
        cells.push(null)
        continue
      }
      const date = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const count = counts.get(date) ?? 0
      const level = count === 0 || maxCount === 0 ? 0 : (Math.min(4, Math.ceil((4 * count) / maxCount)) as 1 | 2 | 3 | 4)
      cells.push({ date, count, level })
    }
    months.push({ key: `${y}-${m}`, label: `${MONTHS[m]} ${y}`, cells })
    m++
    if (m === 12) {
      m = 0
      y++
    }
  }
  return { months, activeDays: extras.calendar.length, maxCount }
}

// ---- Card 2: share of voice and starters ----

export interface VoiceRow {
  name: string
  messages: number
  percent: number
}

/** Top members by messages; everyone else folded into "Others" when there are more than `top`. */
export function shareOfVoice(stats: ChatStats, top = 5): VoiceRow[] {
  const rows = Object.entries(stats.perMember)
    .map(([name, m]) => ({ name, messages: m.messages }))
    .sort((a, b) => b.messages - a.messages || (a.name < b.name ? -1 : 1))
  const total = stats.total
  const head = rows.slice(0, top).map((r) => ({ ...r, percent: percentOf(r.messages, total) }))
  const rest = rows.slice(top)
  if (rest.length > 0) {
    const messages = rest.reduce((sum, r) => sum + r.messages, 0)
    head.push({ name: 'Others', messages, percent: percentOf(messages, total) })
  }
  return head
}

export interface StarterRow {
  name: string
  starters: number
  percent: number
}

/** Who opens conversations, as a share of all starters. */
export function starters(stats: ChatStats): StarterRow[] {
  const rows = Object.entries(stats.perMember)
    .map(([name, m]) => ({ name, starters: m.starters }))
    .sort((a, b) => b.starters - a.starters || (a.name < b.name ? -1 : 1))
  const all = rows.reduce((sum, r) => sum + r.starters, 0)
  return rows.map((r) => ({ ...r, percent: percentOf(r.starters, all) }))
}

/** SVG arc segments for a donut. Angles start at 12 o'clock. */
export interface DonutSegment {
  name: string
  percent: number
  path: string
  colorIndex: number
}

export function donutSegments(rows: VoiceRow[], radius = 40): DonutSegment[] {
  const total = rows.reduce((sum, r) => sum + r.messages, 0)
  if (total === 0) return []
  let angle = -Math.PI / 2
  return rows.map((r, i) => {
    const sweep = (r.messages / total) * Math.PI * 2
    const start = angle
    const end = angle + sweep
    angle = end
    const large = sweep > Math.PI ? 1 : 0
    const p = (a: number) => `${(50 + radius * Math.cos(a)).toFixed(3)} ${(50 + radius * Math.sin(a)).toFixed(3)}`
    // A full circle needs two arcs; one arc from a point to itself draws nothing.
    const path =
      rows.length === 1
        ? `M ${p(start)} A ${radius} ${radius} 0 1 1 ${p(start + Math.PI)} A ${radius} ${radius} 0 1 1 ${p(start)}`
        : `M ${p(start)} A ${radius} ${radius} 0 ${large} 1 ${p(end)}`
    return { name: r.name, percent: r.percent, path, colorIndex: i }
  })
}

// ---- Card 3: rhythm ----

export interface Rhythm {
  recordDay: { date: string; count: number }
  streakDays: number
  streakFrom: string
  streakTo: string
  silenceDays: number
  silenceFrom: string
  silenceTo: string
  peakHour: number
  /** share of messages sent at 22:00 or later, as a percent */
  lateNightPercent: number
  hours: number[]
}

export function rhythm(stats: ChatStats, extras: ChatExtras): Rhythm {
  const hours = stats.hourHistogram.length === 24 ? stats.hourHistogram : new Array<number>(24).fill(0)
  let peakHour = 0
  for (let h = 1; h < 24; h++) if (hours[h] > hours[peakHour]) peakHour = h
  const late = hours.slice(22).reduce((sum, n) => sum + n, 0)
  const silenceMs = Math.max(0, stats.longestSilence.toTs - stats.longestSilence.fromTs)
  return {
    recordDay: stats.busiestDay,
    streakDays: extras.streak.days,
    streakFrom: extras.streak.fromDate,
    streakTo: extras.streak.toDate,
    silenceDays: Math.floor(silenceMs / DAY_MS),
    silenceFrom: formatDay(stats.longestSilence.fromTs),
    silenceTo: formatDay(stats.longestSilence.toTs),
    peakHour,
    lateNightPercent: percentOf(late, stats.total),
    hours,
  }
}

// ---- Card 7: laughs and words ----

export interface LaughRow {
  sender: string
  count: number
  percent: number
}

export function laughRows(laughs: Record<string, number>): LaughRow[] {
  const entries = Object.entries(laughs).filter(([, n]) => n > 0)
  const total = entries.reduce((sum, [, n]) => sum + n, 0)
  return entries
    .map(([sender, count]) => ({ sender, count, percent: percentOf(count, total) }))
    .sort((a, b) => b.count - a.count || (a.sender < b.sender ? -1 : 1))
}
