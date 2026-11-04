import { ParseError, type ChatStats, type MemberStats, type Message, type ParsedChat } from '../shared/types'
import { emojiGraphemes } from './emoji'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const REPLY_WINDOW_MS = 6 * HOUR
const DEFAULT_CONVERSATION_GAP_MS = 6 * HOUR
const TOP_EMOJIS = 5

/** ISO date (YYYY-MM-DD) of the UTC calendar day of ts. */
const isoDay = (ts: number) => new Date(ts).toISOString().slice(0, 10)

/** Monday 00:00 UTC of the week containing ts, as ms. */
function weekStartMs(ts: number): number {
  const d = new Date(ts)
  const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const sinceMonday = (d.getUTCDay() + 6) % 7
  return dayStart - sinceMonday * DAY
}

/**
 * Shift week: among contiguous weeks (zero-filled), the candidate (index >= 4) whose volume
 * differs most from the mean of the 4 previous weeks. Difference is symmetric by ratio:
 * score = r for r >= 1, 1/r for r < 1 (zero volume = infinite). Ties go to the earliest week.
 * Returns null when there are fewer than 8 weeks.
 */
function shiftWeek(messages: Message[]): ChatStats['shiftWeek'] {
  const counts = new Map<number, number>()
  for (const m of messages) {
    const w = weekStartMs(m.ts)
    counts.set(w, (counts.get(w) ?? 0) + 1)
  }
  const first = Math.min(...counts.keys())
  const last = Math.max(...counts.keys())
  const weeks: number[] = []
  for (let w = first; w <= last; w += 7 * DAY) weeks.push(counts.get(w) ?? 0)
  if (weeks.length < 8) return null

  let best: { index: number; ratio: number; score: number } | null = null
  for (let i = 4; i < weeks.length; i++) {
    const mean = weeks.slice(i - 4, i).reduce((a, b) => a + b, 0) / 4
    const ratio = weeks[i] / Math.max(mean, 1)
    const score = ratio >= 1 ? ratio : ratio > 0 ? 1 / ratio : Infinity
    if (!best || score > best.score) best = { index: i, ratio, score }
  }
  if (!best) return null
  return { weekStart: new Date(first + best.index * 7 * DAY).toISOString().slice(0, 10), ratio: best.ratio }
}

export function computeStats(chat: ParsedChat, opts?: { conversationGapMs?: number }): ChatStats {
  const messages = chat.messages
  if (messages.length === 0) throw new ParseError('too_small', 'no messages to analyse')
  const gapMs = opts?.conversationGapMs ?? DEFAULT_CONVERSATION_GAP_MS

  // Sender names are untrusted (e.g. "__proto__", "constructor"): keep these records prototype-less.
  const perMember: Record<string, MemberStats> = Object.create(null)
  const emojiCounts: Record<string, Map<string, number>> = Object.create(null)
  const hourCounts: Record<string, number[]> = Object.create(null)
  const replySum: Record<string, number> = Object.create(null)
  const replyN: Record<string, number> = Object.create(null)

  const hourHistogram = new Array<number>(24).fill(0)
  const weekdayHistogram = new Array<number>(7).fill(0)
  const dayCounts = new Map<string, number>()
  let longest = { fromTs: messages[0].ts, toTs: messages[0].ts, gap: 0 }

  messages.forEach((m, i) => {
    const prev = i > 0 ? messages[i - 1] : undefined
    const gap = prev ? m.ts - prev.ts : Infinity

    let stats = perMember[m.sender]
    if (!stats) {
      stats = perMember[m.sender] = {
        messages: 0,
        words: 0,
        media: 0,
        deleted: 0,
        edited: 0,
        starters: 0,
        topEmojis: [],
        avgReplyMs: null,
        busiestHour: 0,
      }
      emojiCounts[m.sender] = new Map()
      hourCounts[m.sender] = new Array(24).fill(0)
    }

    stats.messages++
    if (m.kind === 'media') stats.media++
    if (m.kind === 'deleted') stats.deleted++
    if (m.edited) stats.edited++
    if (m.kind === 'text') {
      stats.words += m.text.split(/\s+/).filter(Boolean).length
      for (const e of emojiGraphemes(m.text)) {
        emojiCounts[m.sender].set(e, (emojiCounts[m.sender].get(e) ?? 0) + 1)
      }
    }

    if (!prev || gap >= gapMs) stats.starters++

    // Reply: the immediately preceding message is from someone else, within the reply window.
    if (prev && prev.sender !== m.sender && gap < REPLY_WINDOW_MS) {
      replySum[m.sender] = (replySum[m.sender] ?? 0) + gap
      replyN[m.sender] = (replyN[m.sender] ?? 0) + 1
    }

    const d = new Date(m.ts)
    hourHistogram[d.getUTCHours()]++
    hourCounts[m.sender][d.getUTCHours()]++
    weekdayHistogram[d.getUTCDay()]++
    dayCounts.set(isoDay(m.ts), (dayCounts.get(isoDay(m.ts)) ?? 0) + 1)

    if (prev && gap > longest.gap) longest = { fromTs: prev.ts, toTs: m.ts, gap }
  })

  for (const [sender, stats] of Object.entries(perMember)) {
    stats.topEmojis = [...emojiCounts[sender].entries()]
      .sort((a, b) => b[1] - a[1]) // stable: ties keep first-seen order
      .slice(0, TOP_EMOJIS)
    stats.avgReplyMs = replyN[sender] ? replySum[sender] / replyN[sender] : null
    const hours = hourCounts[sender]
    stats.busiestHour = hours.indexOf(Math.max(...hours)) // lowest hour wins ties
  }

  let busiestDay = { date: '', count: 0 }
  for (const [date, count] of [...dayCounts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (count > busiestDay.count) busiestDay = { date, count }
  }

  const firstTs = Math.min(...messages.map((m) => m.ts))
  const lastTs = Math.max(...messages.map((m) => m.ts))
  const days = Math.round((Date.UTC(...dayParts(lastTs)) - Date.UTC(...dayParts(firstTs))) / DAY) + 1

  return {
    firstTs,
    lastTs,
    days,
    total: messages.length,
    perMember,
    hourHistogram,
    weekdayHistogram,
    busiestDay,
    longestSilence: { fromTs: longest.fromTs, toTs: longest.toTs },
    shiftWeek: shiftWeek(messages),
  }
}

function dayParts(ts: number): [number, number, number] {
  const d = new Date(ts)
  return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()]
}

export function assertAnalyzable(chat: ParsedChat): void {
  const senders = new Set(chat.messages.map((m) => m.sender))
  if (chat.messages.length < 30 || senders.size < 2) {
    throw new ParseError('too_small', 'chat needs at least 30 messages from 2 senders')
  }
}
