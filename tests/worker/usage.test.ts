import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Env } from '../../src/worker/index'
import { UsageBuffer, bump, dayOf, pruneUsage, recordVisitor } from '../../src/worker/usage'
import { applyMigrations } from './support'

const DB = (env as unknown as Env).DB
const SECRET = 'test-visitor-secret-0123456789abcdef'
const OTHER_SECRET = 'another-visitor-secret-0123456789'

beforeAll(async () => {
  await applyMigrations(DB)
})

beforeEach(async () => {
  await DB.batch([DB.prepare('DELETE FROM usage_daily'), DB.prepare('DELETE FROM visitors')])
})

const count = async (day: string, metric: string, key: string) =>
  (await DB.prepare('SELECT count FROM usage_daily WHERE day = ? AND metric = ? AND key = ?').bind(day, metric, key).first<{ count: number }>())?.count ?? 0

const visitorsOn = async (day: string) =>
  (await DB.prepare('SELECT visitor FROM visitors WHERE day = ?').bind(day).all<{ visitor: string }>()).results.map((r) => r.visitor)

const sha256Hex = async (text: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), (b) => b.toString(16).padStart(2, '0')).join('')

describe('dayOf', () => {
  it('formats a UTC calendar day', () => {
    expect(dayOf(Date.UTC(2026, 10, 5, 23, 59))).toBe('2026-11-05')
    expect(dayOf(Date.UTC(2026, 0, 1, 0, 0))).toBe('2026-01-01')
  })
})

describe('bump', () => {
  it('creates a row and adds to it on later bumps', async () => {
    await bump(DB, '2026-11-05', 'upload', 'all')
    await bump(DB, '2026-11-05', 'upload', 'all', 4)
    expect(await count('2026-11-05', 'upload', 'all')).toBe(5)
  })
})

describe('recordVisitor', () => {
  it('counts one visitor once per day and differs across days', async () => {
    await recordVisitor(DB, SECRET, '2026-11-05', '203.0.113.7')
    await recordVisitor(DB, SECRET, '2026-11-05', '203.0.113.7')
    await recordVisitor(DB, SECRET, '2026-11-06', '203.0.113.7')
    const day1 = await visitorsOn('2026-11-05')
    const day2 = await visitorsOn('2026-11-06')
    expect(day1).toHaveLength(1)
    expect(day2).toHaveLength(1)
    expect(day1[0]).toMatch(/^[0-9a-f]{64}$/)
    expect(day1[0]).not.toBe(day2[0])
    expect(day1[0]).not.toContain('203.0.113.7')
  })

  it('gives a different value for a different secret', async () => {
    await recordVisitor(DB, SECRET, '2026-11-07', '198.51.100.1')
    await recordVisitor(DB, OTHER_SECRET, '2026-11-08', '198.51.100.1')
    await recordVisitor(DB, OTHER_SECRET, '2026-11-07', '198.51.100.1')
    const first = await visitorsOn('2026-11-07')
    expect(first).toHaveLength(2)
    expect(first.length).toBe(new Set(first).size)
  })

  it('stores a keyed value, not the plain sha256 of the input', async () => {
    await recordVisitor(DB, SECRET, '2026-11-09', '192.0.2.44')
    const [stored] = await visitorsOn('2026-11-09')
    expect(stored).not.toBe(await sha256Hex('2026-11-09:192.0.2.44'))
  })

  it('writes nothing when the secret is missing or shorter than 24 characters', async () => {
    await recordVisitor(DB, null, '2026-11-10', '192.0.2.45')
    await recordVisitor(DB, undefined, '2026-11-10', '192.0.2.45')
    await recordVisitor(DB, 'too-short', '2026-11-10', '192.0.2.45')
    expect(await visitorsOn('2026-11-10')).toHaveLength(0)
  })
})

describe('pruneUsage', () => {
  it('removes rows older than 90 days and keeps recent ones', async () => {
    const now = Date.UTC(2026, 10, 5)
    const old = dayOf(now - 91 * 86_400_000)
    const recent = dayOf(now - 10 * 86_400_000)
    await bump(DB, old, 'upload', 'all')
    await bump(DB, recent, 'upload', 'all')
    await recordVisitor(DB, SECRET, old, 'x')
    await recordVisitor(DB, SECRET, recent, 'x')
    await pruneUsage(DB, now)
    expect(await count(old, 'upload', 'all')).toBe(0)
    expect(await count(recent, 'upload', 'all')).toBe(1)
    const v = await DB.prepare('SELECT COUNT(*) AS n FROM visitors').first<{ n: number }>()
    expect(v?.n).toBe(1)
  })
})

describe('UsageBuffer', () => {
  it('flushes many keys in a few statements and sums repeated adds', async () => {
    const buf = new UsageBuffer(() => Date.UTC(2026, 10, 5))
    for (let i = 0; i < 60; i++) buf.add('llm_call', `gemini:model-${i}`)
    buf.add('llm_call', 'gemini:model-0', 2)
    let prepares = 0
    const counting = new Proxy(DB, {
      get(target, prop) {
        if (prop === 'prepare') return (q: string) => (prepares++, target.prepare(q))
        const v = (target as unknown as Record<string | symbol, unknown>)[prop]
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v
      },
    })
    await buf.flush(counting)
    expect(prepares).toBeLessThanOrEqual(3)
    expect(await count('2026-11-05', 'llm_call', 'gemini:model-0')).toBe(3)
    expect(await count('2026-11-05', 'llm_call', 'gemini:model-59')).toBe(1)
  })

  it('never throws out of flush when the database fails', async () => {
    const broken = { prepare: () => { throw new Error('boom') }, batch: () => { throw new Error('boom') } } as unknown as D1Database
    const buf = new UsageBuffer(() => Date.now())
    buf.add('upload', 'all')
    await expect(buf.flush(broken)).resolves.toBeUndefined()
  })
})
