import { env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../../src/worker/db'
import { ADVANCE_DEADLINE_MS, advanceReport, LEASE_MS, MAX_FAILURES, RETRIEVED_MAX_CHARS, retrievedLines } from '../../src/worker/jobs'
import type { Env } from '../../src/worker/index'
import { applyMigrations, chatWith, fakeProvider, isSummaryCall, uploadBody } from './support'

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
    const claim = await db.claimAttempt(reportId, MAX_FAILURES, 60_000)
    const token = claim && claim.outcome === 'claimed' ? claim.token : -1
    await db.failReport(reportId, 'llm_error')
    expect(await db.advanceProgress(reportId, { progress: 1, total: 3 }, token)).toBe(false)
    expect(await db.finishReport(reportId, { title: 'x' } as never, 3, token)).toBe(false)
    expect(await db.getReport(reportId)).toMatchObject({ status: 'failed' })
  })

  it('a stale lease holder cannot write after another attempt took the lease over (fencing token)', async () => {
    let t = 5_000_000
    const now = () => t
    const { db, reportId } = await setup(now)
    const a = await db.claimAttempt(reportId, MAX_FAILURES, 60_000)
    expect(a).toMatchObject({ outcome: 'claimed' })
    t += 61_000 // A's lease expires while A is still running
    const b = await db.claimAttempt(reportId, MAX_FAILURES, 60_000)
    expect(b).toMatchObject({ outcome: 'claimed' })
    const tokenA = (a as { token: number }).token
    const tokenB = (b as { token: number }).token
    expect(tokenB).not.toBe(tokenA)
    expect(await db.advanceProgress(reportId, { progress: 1, total: 3 }, tokenA)).toBe(false)
    expect(await db.finishReport(reportId, { title: 'x' } as never, 3, tokenA)).toBe(false)
    expect(await db.failAttempt(reportId, 'llm_error', MAX_FAILURES, tokenA)).toBeNull()
    expect(await db.advanceProgress(reportId, { progress: 1, total: 3 }, tokenB)).toBe(true)
  })

  it('every model call carries an abort signal and the whole advance is bounded below the lease', async () => {
    const now = () => 6_000_000
    const { reportId } = await setup(now)
    const provider = fakeProvider()
    await advanceReport(E, reportId, { provider, now })
    expect(provider.calls[0].signal).toBeInstanceOf(AbortSignal)
    expect(ADVANCE_DEADLINE_MS).toBeLessThan(LEASE_MS)
  })
})

describe('retrievedLines', () => {
  it('keeps chunk order by idx, drops day headers and blank lines', () => {
    const lines = retrievedLines(
      [
        { idx: 2, text: '--- 2025-08-02 ---\n09:00 Ben: later\n' },
        { idx: 0, text: '--- 2025-08-01 ---\n10:00 Ana: first\r\n\n10:01 Ben: second' },
      ],
      'nothing matches here',
    )
    expect(lines).toEqual(['10:00 Ana: first', '10:01 Ben: second', '09:00 Ben: later'])
  })

  it('stops before the total passes RETRIEVED_MAX_CHARS', () => {
    const text = Array.from({ length: 20 }, () => 'x'.repeat(999)).join('\n')
    const lines = retrievedLines([{ idx: 0, text }], 'zebra')
    const total = lines.reduce((n, l) => n + l.length + 1, 0)
    expect(total).toBeLessThanOrEqual(RETRIEVED_MAX_CHARS)
    expect(lines.length).toBe(Math.floor(RETRIEVED_MAX_CHARS / 1000))
  })

  it('picks the lines that match the question before filling with the rest', () => {
    const filler = Array.from({ length: 30 }, (_, i) => `09:${String(i).padStart(2, '0')} Ana: ${'filler '.repeat(40)}`)
    const text = [...filler, '23:59 Ben: the umbrella was found by Dana'].join('\n')
    const lines = retrievedLines([{ idx: 3, text }], 'Who found the umbrella?')
    expect(lines).toContain('23:59 Ben: the umbrella was found by Dana')
  })
})

describe('direct mode (LLM_DIRECT=1): one model call for the whole chat', () => {
  const direct = (over: Record<string, string> = {}) => ({ ...E, LLM_DIRECT: '1', ...over }) as Env

  it('a many-chunk chat is reported in ONE call with the full transcript, no summaries', async () => {
    const now = () => 7_000_000
    const { reportId, chunks } = await setup(now)
    expect(chunks).toBeGreaterThan(3)
    const provider = fakeProvider()
    const state = await advanceReport(direct(), reportId, { provider, now })
    expect(state).toMatchObject({ status: 'done', phase: 'done' })
    expect(provider.calls).toHaveLength(1)
    expect(isSummaryCall(provider.calls[0])).toBe(false)
    expect(provider.calls[0].prompt).toContain('Full chat transcript')
    expect(provider.calls[0].prompt).toContain('Ana: hello there')
  })

  it('falls back to chunk summaries when the chat is bigger than LLM_DIRECT_MAX_CHARS', async () => {
    const now = () => 7_100_000
    const { reportId } = await setup(now)
    const provider = fakeProvider()
    await advanceReport(direct({ LLM_DIRECT_MAX_CHARS: '100' }), reportId, { provider, now })
    expect(isSummaryCall(provider.calls[0])).toBe(true)
  })

  it('is off unless LLM_DIRECT is 1', async () => {
    const now = () => 7_200_000
    const { reportId } = await setup(now)
    const provider = fakeProvider()
    await advanceReport(E, reportId, { provider, now })
    expect(isSummaryCall(provider.calls[0])).toBe(true)
  })

  it('a follow-up in direct mode needs no summaries: one call with the retrieved lines', async () => {
    const now = () => 7_300_000
    const { db, chatId } = await setup(now)
    const reportId = await db.createReport({ chatId, persona: 'brandon', language: 'English', me: 'Ana', kind: 'followup', question: 'who said hello there', total: 2 })
    const followupReply = () => JSON.stringify({ title: '', intro: '', verdict: 'Ana said it.', dynamic: '', shiftWeekNote: '', runningJokes: [], sections: [{ emoji: '🔎', heading: 'Answer', body: 'Ana said hello there.' }], advice: '' })
    const provider = fakeProvider(followupReply)
    const state = await advanceReport(direct(), reportId, { provider, now })
    expect(provider.calls).toHaveLength(1)
    expect(provider.calls[0].prompt).toContain('who said hello there')
    expect(state).toMatchObject({ status: 'done' })
  })
})

