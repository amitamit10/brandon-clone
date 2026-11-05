/**
 * Daily usage counters and anonymous daily visitors. Counts only: no chat text, no names and no raw IPs.
 * Every write here is best effort: callers wrap them with quietly() so counting never breaks a request or a job.
 */
import type { LlmCallInfo } from '../llm/index'

const DAY_MS = 86_400_000
/** Rows older than this many days are deleted by the daily cron. */
export const USAGE_KEEP_DAYS = 90
/** Rows per multi-row upsert: 4 bound parameters each, so 25 rows stay under 100 parameters. */
const ROWS_PER_UPSERT = 25

/** UTC calendar day as YYYY-MM-DD. */
export function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Adds `by` to one counter for a day. One atomic upsert. */
export async function bump(d1: D1Database, day: string, metric: string, key: string, by = 1): Promise<void> {
  await d1
    .prepare(
      'INSERT INTO usage_daily (day, metric, key, count) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT (day, metric, key) DO UPDATE SET count = count + ?',
    )
    .bind(day, metric, key, by, by)
    .run()
}

/**
 * Counts one anonymous visitor for the day. The stored value is sha256(`${day}:${ipBucketKey}`), so the same
 * person gets a different value on every day, and the IP itself is never stored.
 */
export async function recordVisitor(d1: D1Database, day: string, ipBucketKey: string): Promise<void> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${day}:${ipBucketKey}`))
  const visitor = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  await d1.prepare('INSERT OR IGNORE INTO visitors (day, visitor) VALUES (?, ?)').bind(day, visitor).run()
}

/** Deletes usage counters and visitor rows for days before the 90-day cutoff. */
export async function pruneUsage(d1: D1Database, now: number): Promise<void> {
  const cutoff = dayOf(now - USAGE_KEEP_DAYS * DAY_MS)
  await d1.batch([
    d1.prepare('DELETE FROM usage_daily WHERE day < ?').bind(cutoff),
    d1.prepare('DELETE FROM visitors WHERE day < ?').bind(cutoff),
  ])
}

/** Runs a counting write and ignores any failure. */
export async function quietly(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch {
    // Counting must never break a request or a job.
  }
}

interface Pending {
  day: string
  metric: string
  key: string
  count: number
}

/**
 * Collects counters in memory and writes them in one multi-row upsert per 25 rows. Used on the advance path,
 * where one request can make many LLM attempts: each attempt only touches memory, so the D1 query budget
 * per request does not grow with the number of attempts.
 */
export class UsageBuffer {
  private rows = new Map<string, Pending>()

  constructor(private now: () => number = Date.now) {}

  add(metric: string, key: string, by = 1): void {
    const day = dayOf(this.now())
    const id = `${day}\u0000${metric}\u0000${key}`
    const row = this.rows.get(id)
    if (row) row.count += by
    else this.rows.set(id, { day, metric, key, count: by })
  }

  /** Counts one underlying LLM attempt: calls, plus fails and 429s when it did not succeed. */
  llmCall(info: LlmCallInfo): void {
    const key = `${info.provider}:${info.model}`
    this.add('llm_call', key)
    if (!info.ok) this.add('llm_fail', key)
    if (info.rateLimited) this.add('llm_429', key)
  }

  async flush(d1: D1Database): Promise<void> {
    const all = [...this.rows.values()]
    this.rows.clear()
    for (let i = 0; i < all.length; i += ROWS_PER_UPSERT) {
      const part = all.slice(i, i + ROWS_PER_UPSERT)
      await quietly(() =>
        d1
          .prepare(
            `INSERT INTO usage_daily (day, metric, key, count) VALUES ${part.map(() => '(?, ?, ?, ?)').join(', ')} ` +
              'ON CONFLICT (day, metric, key) DO UPDATE SET count = count + excluded.count',
          )
          .bind(...part.flatMap((r) => [r.day, r.metric, r.key, r.count]))
          .run(),
      )
    }
  }
}
