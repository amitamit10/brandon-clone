import { env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../../src/worker/db'
import { advanceReport, MAX_FAILURES } from '../../src/worker/jobs'
import type { Env } from '../../src/worker/index'
import { applyMigrations, chatWith, fakeProvider, uploadBody } from './support'

const E = env as unknown as Env
beforeAll(async () => {
  await applyMigrations(E.DB)
})

async function setup(now: () => number) {
  const db = createDb(E.DB, now)
  const body = uploadBody(chatWith(40), 200) // several small chunks
  const chatId = await db.insertChat({ name: body.name, participants: body.participants, stats: body.stats, chunks: body.chunks, expiresAt: now() + 86_400_000 })
  const reportId = await db.createReport({ chatId, persona: 'brandon', language: 'English', me: 'Ana', kind: 'group', total: body.chunks.length + 1 })
  return { db, chatId, reportId, chunks: body.chunks.length }
}

describe('advanceReport claims and leases', () => {
  it('a crashed attempt still counts: after MAX_FAILURES claims with no result the report fails with no LLM call', async () => {
    let t = 1_000_000
    const now = () => t
    const { db, reportId } = await setup(now)
    for (let i = 0; i < MAX_FAILURES; i++) {
      const c = await db.claimAttempt(reportId, MAX_FAILURES, 60_000)
      expect(c).toMatchObject({ outcome: 'claimed', failures: i + 1 })
      t += 61_000 // the lease of the "crashed" attempt expires
    }
    const provider = fakeProvider()
    const state = await advanceReport(E, reportId, { provider, now })
    expect(state).toMatchObject({ status: 'failed', phase: 'failed' })
    expect(provider.calls).toHaveLength(0)
  })

  it('a second advance while the first holds the lease makes no LLM call', async () => {
    const t = 2_000_000
    const now = () => t
    const { reportId } = await setup(now)
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const slow = fakeProvider()
    const original = slow.generate.bind(slow)
    slow.generate = async (req) => {
      await gate
      return original(req)
    }
    const first = advanceReport(E, reportId, { provider: slow, now })
    // wait until the first call has reached the provider
    for (let i = 0; i < 50 && slow.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 5))
    const other = fakeProvider()
    const second = await advanceReport(E, reportId, { provider: other, now })
    expect(other.calls).toHaveLength(0)
    expect(second).toMatchObject({ status: 'running' })
    release()
    expect(await first).toMatchObject({ status: 'running' })
    expect(slow.calls).toHaveLength(1)
  })

  it('the lease expires so a crashed attempt can be retried', async () => {
    let t = 3_000_000
    const now = () => t
    const { db, reportId } = await setup(now)
    await db.claimAttempt(reportId, MAX_FAILURES, 60_000) // crashed holder
    const p1 = fakeProvider()
    await advanceReport(E, reportId, { provider: p1, now: () => t + 30_000 })
    expect(p1.calls).toHaveLength(0) // still leased
    t += 61_000
    const p2 = fakeProvider()
    await advanceReport(E, reportId, { provider: p2, now })
    expect(p2.calls).toHaveLength(1)
  })

  it('late writes cannot resurrect or overwrite a failed or done report', async () => {
    const now = () => 4_000_000
    const { db, reportId } = await setup(now)
    await db.failReport(reportId, 'llm_error')
    expect(await db.advanceProgress(reportId, { progress: 1, total: 3 })).toBe(false)
    expect(await db.finishReport(reportId, { title: 'x' } as never, 3)).toBe(false)
    expect(await db.getReport(reportId)).toMatchObject({ status: 'failed' })
  })
})
