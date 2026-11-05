import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Env } from '../../src/worker/index'
import { UsageBuffer, bump, dayOf, pruneUsage, recordVisitor } from '../../src/worker/usage'
import { applyMigrations } from './support'

const DB = (env as unknown as Env).DB

beforeAll(async () => {
  await applyMigrations(DB)
})

beforeEach(async () => {
  await DB.batch([DB.prepare('DELETE FROM usage_daily'), DB.prepare('DELETE FROM visitors')])
})

const count = async (day: string, metric: string, key: string) =>
  (await DB.prepare('SELECT count FROM usage_daily WHERE day = ? AND metric = ? AND key = ?').bind(day, metric, key).first<{ count: number }>())?.count ?? 0

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
  it('counts one visitor once per day, stores only a hash, and differs across days', async () => {
    await recordVisitor(DB, '2026-11-05', '203.0.113.7')
    await recordVisitor(DB, '2026-11-05', '203.0.113.7')
    await recordVisitor(DB, '2026-11-06', '203.0.113.7')
    const day1 = await DB.prepare('SELECT visitor FROM visitors WHERE day = ?').bind('2026-11-05').all<{ visitor: string }>()
    const day2 = await DB.prepare('SELECT visitor FROM visitors WHERE day = ?').bind('2026-11-06').all<{ visitor: string }>()
    expect(day1.results).toHaveLength(1)
    expect(day2.results).toHaveLength(1)
    expect(day1.results[0].visitor).toMatch(/^[0-9a-f]{64}$/)
    expect(day1.results[0].visitor).not.toBe(day2.results[0].visitor)
    expect(day1.results[0].visitor).not.toContain('203.0.113.7')
  })
})

describe('pruneUsage', () => {
  it('removes rows older than 90 days and keeps recent ones', async () => {
    const now = Date.UTC(2026, 10, 5)
    const old = dayOf(now - 91 * 86_400_000)
    const recent = dayOf(now - 10 * 86_400_000)
    await bump(DB, old, 'upload', 'all')
    await bump(DB, recent, 'upload', 'all')
    await recordVisitor(DB, old, 'x')
    await recordVisitor(DB, recent, 'x')
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
