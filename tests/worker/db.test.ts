import { env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import schema from '../../migrations/0001_init.sql?raw'
import { createDb, randomId } from '../../src/worker/db'
import type { Env } from '../../src/worker/index'
import type { Chunk, ChunkSummary, GroupReport } from '../../src/shared/types'
import { statsChat } from '../fixtures/stats-chat'
import { computeStats } from '../../src/stats/compute'

const DB = (env as unknown as Env).DB

beforeAll(async () => {
  const statements = schema
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  await DB.batch(statements.map((s) => DB.prepare(s)))
})

const chunks = (n: number): Chunk[] =>
  Array.from({ length: n }, (_, i) => ({ index: i, fromId: i * 2, toId: i * 2 + 1, text: `--- 2025-08-01 ---\nchunk ${i}` }))

const summary: ChunkSummary = { index: 0, events: ['e'], jokes: ['j'], memberNotes: { Ana: 'n' }, quotes: ['q'] }

const newChat = (over: { expiresAt?: number; chunks?: Chunk[] } = {}) => ({
  name: 'Test group',
  participants: ['Ana', 'Ben', 'Cy'],
  stats: computeStats(statsChat),
  chunks: over.chunks ?? chunks(3),
  expiresAt: over.expiresAt ?? Date.now() + 86_400_000,
})

const newReport = (chatId: string) => ({
  chatId,
  persona: 'brandon' as const,
  language: 'English',
  me: 'Ana',
  kind: 'group' as const,
  total: 3,
})

describe('randomId', () => {
  it('returns 32 hex characters and differs between calls', () => {
    const a = randomId()
    const b = randomId()
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(b).toMatch(/^[0-9a-f]{32}$/)
    expect(a).not.toBe(b)
  })
})

describe('createDb', () => {
  const db = createDb(DB)

  it('insertChat then getChunks round-trips', async () => {
    const id = await db.insertChat(newChat())
    expect(id).toMatch(/^[0-9a-f]{32}$/)

    const chat = await db.getChat(id)
    expect(chat?.name).toBe('Test group')
    expect(chat?.participants).toEqual(['Ana', 'Ben', 'Cy'])
    expect(chat?.stats.total).toBe(statsChat.messages.length)

    const rows = await db.getChunks(id)
    expect(rows.map((r) => r.idx)).toEqual([0, 1, 2])
    expect(rows[1].text).toBe(chunks(3)[1].text)
    expect(rows[1].summary).toBeNull()

    await db.saveSummary(id, 1, summary)
    expect((await db.getChunks(id))[1].summary).toEqual(summary)
  })

  it('chat ids are random, not sequential', async () => {
    const a = await db.insertChat(newChat())
    const b = await db.insertChat(newChat())
    expect(a).not.toBe(b)
    expect(BigInt('0x' + b) - BigInt('0x' + a)).not.toBe(1n)
  })

  it('JSON round trip keeps sender-keyed records prototype-free', async () => {
    const stats = computeStats(statsChat)
    const perMember: typeof stats.perMember = Object.create(null)
    for (const [name, m] of Object.entries(stats.perMember)) perMember[name] = m
    perMember['__proto__'] = stats.perMember.Ana
    const id = await db.insertChat({ ...newChat(), stats: { ...stats, perMember } })

    const chat = await db.getChat(id)
    expect(Object.getPrototypeOf(chat?.stats.perMember)).toBeNull()
    expect(Object.keys(chat?.stats.perMember ?? {})).toContain('__proto__')
    expect(chat?.stats.perMember.Ben.messages).toBe(stats.perMember.Ben.messages)
    expect(chat?.stats.perMember['constructor']).toBeUndefined()

    const noteRecord: Record<string, string> = Object.create(null)
    noteRecord['constructor'] = 'x'
    await db.saveSummary(id, 0, { index: 0, events: [], jokes: [], memberNotes: noteRecord, quotes: [] })
    const summary = (await db.getChunks(id))[0].summary
    expect(Object.getPrototypeOf(summary?.memberNotes)).toBeNull()
    expect(summary?.memberNotes['constructor']).toBe('x')
  })

  it('deleteChat removes chunks and reports and share lookup returns null', async () => {
    const chatId = await db.insertChat(newChat())
    const reportId = await db.createReport(newReport(chatId))
    await db.setShare(reportId, 'share-del-1')
    expect((await db.getReportByShare('share-del-1'))?.id).toBe(reportId)

    await db.deleteChat(chatId)
    expect(await db.getChat(chatId)).toBeNull()
    expect(await db.getChunks(chatId)).toEqual([])
    expect(await db.getReport(reportId)).toBeNull()
    expect(await db.getReportByShare('share-del-1')).toBeNull()
  })

  it('deleteExpired removes only expired chats', async () => {
    const now = Date.now()
    const old = await db.insertChat(newChat({ expiresAt: now - 1 }))
    const fresh = await db.insertChat(newChat({ expiresAt: now + 60_000 }))

    const removed = await db.deleteExpired(now)
    expect(removed).toBeGreaterThanOrEqual(1)
    expect(await db.getChat(old)).toBeNull()
    expect(await db.getChunks(old)).toEqual([])
    expect(await db.getChat(fresh)).not.toBeNull()
  })

  it('setShare(null) revokes the link', async () => {
    const chatId = await db.insertChat(newChat())
    const reportId = await db.createReport(newReport(chatId))
    await db.setShare(reportId, 'share-revoke-1')
    expect((await db.getReportByShare('share-revoke-1'))?.id).toBe(reportId)

    await db.setShare(reportId, null)
    expect(await db.getReportByShare('share-revoke-1')).toBeNull()
    expect((await db.getReport(reportId))?.shareId).toBeNull()
  })

  it('createReport starts queued, and updateReport stores JSON content', async () => {
    const chatId = await db.insertChat(newChat())
    const reportId = await db.createReport(newReport(chatId))
    expect((await db.getReport(reportId))?.status).toBe('queued')

    await db.updateReport(reportId, { status: 'done', progress: 3, content: { title: 't' } as unknown as GroupReport })
    const row = await db.getReport(reportId)
    expect(row?.status).toBe('done')
    expect(row?.progress).toBe(3)
    expect(row?.content).toEqual({ title: 't' })
  })

  it('deleteReport removes only that report', async () => {
    const chatId = await db.insertChat(newChat())
    const r1 = await db.createReport(newReport(chatId))
    const r2 = await db.createReport(newReport(chatId))
    await db.deleteReport(r1)
    expect(await db.getReport(r1)).toBeNull()
    expect(await db.getReport(r2)).not.toBeNull()
  })
})

describe('retention is enforced on reads, not only by the cron', () => {
  const T = 5_000_000_000_000 // fixed "expiry" instant
  it('expired chats, chunks, reports and share links read as not found even before cleanup', async () => {
    const clock = { now: T - 1000 }
    const db = createDb(DB, () => clock.now)
    const chatId = await db.insertChat(newChat({ expiresAt: T }))
    const reportId = await db.createReport(newReport(chatId))
    await db.setShare(reportId, 'sharetoken-expiry-test')
    expect(await db.getChat(chatId)).not.toBeNull()
    expect((await db.getChunks(chatId)).length).toBe(3)
    expect(await db.getReport(reportId)).not.toBeNull()
    expect(await db.getReportByShare('sharetoken-expiry-test')).not.toBeNull()

    clock.now = T // expired exactly now
    expect(await db.getChat(chatId)).toBeNull()
    expect(await db.getChunks(chatId)).toEqual([])
    expect(await db.getReport(reportId)).toBeNull()
    expect(await db.getReportByShare('sharetoken-expiry-test')).toBeNull()
    // physically still there until the cron runs
    const left = await DB.prepare('SELECT COUNT(*) AS n FROM chats WHERE id = ?').bind(chatId).first<{ n: number }>()
    expect(left?.n).toBe(1)
  })

  it('deleteExpired uses a fixed number of queries however many chats expired', async () => {
    const now = 4_000_000_000_000
    const db0 = createDb(DB)
    for (let i = 0; i < 60; i++) {
      const id = await db0.insertChat(newChat({ expiresAt: now - 1 - i, chunks: chunks(1) }))
      await db0.createReport(newReport(id))
    }
    let prepares = 0
    const counting = new Proxy(DB, {
      get(target, prop) {
        if (prop === 'prepare') return (q: string) => (prepares++, target.prepare(q))
        const v = (target as unknown as Record<string | symbol, unknown>)[prop]
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v
      },
    })
    const removed = await createDb(counting).deleteExpired(now)
    expect(removed).toBeGreaterThanOrEqual(60)
    expect(prepares).toBeLessThanOrEqual(3)
    const rest = await DB.prepare('SELECT COUNT(*) AS n FROM chats WHERE expires_at <= ?').bind(now).first<{ n: number }>()
    expect(rest?.n).toBe(0)
  })
})

