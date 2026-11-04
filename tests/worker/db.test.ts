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
