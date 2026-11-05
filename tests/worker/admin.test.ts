import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp, type Env } from '../../src/worker/index'
import { createDb, randomId } from '../../src/worker/db'
import { computeStats } from '../../src/stats/compute'
import { chunkMessages } from '../../src/pipeline/chunk'
import { applyMigrations, chatWith, defaultReply, fakeProvider, uploadBody } from './support'

const ENV = env as unknown as Env
const DB = ENV.DB
const TOKEN = 'test-admin-token-0123456789abcdef'
const BASE = 'http://localhost'
const HOUR = 3_600_000

beforeAll(async () => {
  await applyMigrations(DB)
})

beforeEach(async () => {
  await DB.batch([
    DB.prepare('DELETE FROM reports'),
    DB.prepare('DELETE FROM chat_chunks'),
    DB.prepare('DELETE FROM chats'),
    DB.prepare('DELETE FROM usage_daily'),
    DB.prepare('DELETE FROM visitors'),
    DB.prepare('DELETE FROM rate'),
  ])
})

type App = ReturnType<typeof createApp>
interface CallOpts {
  json?: unknown
  raw?: string
  cookie?: string
  headers?: Record<string, string>
  ip?: string
  env?: Env
  /** Defaults to true for POST and DELETE. */
  adminHeader?: boolean
}

function call(app: App, method: string, path: string, opts: CallOpts = {}): Promise<Response> {
  const headers: Record<string, string> = { 'CF-Connecting-IP': opts.ip ?? `adm-${randomId()}`, ...(opts.headers ?? {}) }
  let body: string | undefined
  if (opts.json !== undefined) body = JSON.stringify(opts.json)
  if (opts.raw !== undefined) body = opts.raw
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (opts.cookie) headers.cookie = `admin_session=${opts.cookie}`
  const mutating = method !== 'GET'
  if ((opts.adminHeader ?? mutating) && mutating) headers['X-Admin'] = '1'
  return Promise.resolve(app.request(`${BASE}${path}`, { method, headers, body }, opts.env ?? ENV))
}

/** Logs in and returns the session cookie value. */
async function login(app: App, ip = `adm-${randomId()}`): Promise<{ value: string; setCookie: string }> {
  const res = await call(app, 'POST', '/api/admin/login', { json: { token: TOKEN }, ip })
  expect(res.status).toBe(200)
  const setCookie = res.headers.get('set-cookie') ?? ''
  const match = /admin_session=([^;]+)/.exec(setCookie)
  expect(match).not.toBeNull()
  return { value: match![1], setCookie }
}

const count = async (sql: string, ...binds: unknown[]) => {
  const row = await DB.prepare(sql).bind(...binds).first<{ n: number }>()
  return row?.n ?? 0
}

const usageSum = (metric: string, key: string) =>
  count('SELECT COALESCE(SUM(count), 0) AS n FROM usage_daily WHERE metric = ? AND key = ?', metric, key)

const today = () => new Date().toISOString().slice(0, 10)

async function seedChat(opts: { name: string; uploader: string | null; participants: string[]; text?: string; expiresAt?: number; id?: string }) {
  const chat = chatWith(40, opts.participants)
  const chunks = chunkMessages(chat, 24_000)
  const text = opts.text ?? 'SECRET-TEXT'
  const withText = chunks.map((c, i) => ({ ...c, text: i === 0 ? `${text} ${c.text}` : c.text }))
  if (opts.id) {
    await DB.prepare('INSERT INTO chats (id, name, participants_json, stats_json, created_at, expires_at, uploader_name) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(opts.id, opts.name, JSON.stringify(opts.participants), JSON.stringify({ total: 40 }), Date.now() - 1000, opts.expiresAt ?? Date.now() + 86_400_000, opts.uploader)
      .run()
    await DB.prepare('INSERT INTO chat_chunks (chat_id, idx, text, summary_json) VALUES (?, 0, ?, NULL)').bind(opts.id, text).run()
    return opts.id
  }
  return createDb(DB).insertChat({
    name: opts.name,
    uploaderName: opts.uploader,
    participants: opts.participants,
    stats: computeStats(chat),
    chunks: withText,
    expiresAt: opts.expiresAt ?? Date.now() + 86_400_000,
  })
}

async function seedReport(chatId: string, over: { status?: 'queued' | 'done' | 'failed'; kind?: 'group' | 'member' | 'followup'; question?: string; me?: string; shareId?: string } = {}) {
  const db = createDb(DB)
  const id = await db.createReport({ chatId, persona: 'clara', language: 'English', me: over.me ?? 'Ana', kind: over.kind ?? 'group', question: over.question, total: 2 })
  if (over.status === 'done') {
    await db.updateReport(id, { status: 'done', progress: 2, total: 2, content: { title: 'REPORT-TITLE', intro: 'REPORT-INTRO', sections: [], members: [] } as never })
  } else if (over.status === 'failed') {
    await db.updateReport(id, { status: 'failed', error: 'llm_error' })
  }
  if (over.shareId) await db.setShare(id, over.shareId)
  return id
}

async function uploadPublic(app: App, uploaderName: string, participants: string[], ip: string): Promise<string> {
  const res = await call(app, 'POST', '/api/chats', { json: { ...uploadBody(chatWith(40, participants)), uploaderName }, ip })
  expect(res.status).toBe(201)
  return ((await res.json()) as { chatId: string }).chatId
}

describe('admin is disabled without a usable token', () => {
  it('answers 404 for every admin route when ADMIN_TOKEN is missing or short', async () => {
    const app = createApp()
    for (const token of [undefined, '', 'short-token']) {
      const off = { ...ENV, ADMIN_TOKEN: token } as Env
      expect((await call(app, 'GET', '/api/admin/overview', { env: off })).status).toBe(404)
      expect(await (await call(app, 'POST', '/api/admin/login', { json: { token: TOKEN }, env: off })).json()).toEqual({ error: 'not_found' })
      expect((await call(app, 'DELETE', '/api/admin/chats/deadbeef', { env: off })).status).toBe(404)
    }
  })
})

describe('login and sessions', () => {
  it('sets an HttpOnly, SameSite=Strict, path-scoped cookie on success', async () => {
    const app = createApp()
    const { setCookie } = await login(app)
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/SameSite=Strict/i)
    expect(setCookie).toMatch(/Path=\/api\/admin/)
    expect(setCookie).toMatch(/Max-Age=43200/)
    expect(setCookie).not.toMatch(/Secure/i)
  })

  it('adds Secure when the request is https', async () => {
    const app = createApp()
    const res = await Promise.resolve(
      app.request('https://example.com/api/admin/login', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': randomId(), 'content-type': 'application/json', 'X-Admin': '1' },
        body: JSON.stringify({ token: TOKEN }),
      }, ENV),
    )
    expect(res.headers.get('set-cookie')).toMatch(/Secure/i)
  })

  it('answers 401 for a wrong token and counts a failed login', async () => {
    const app = createApp()
    const before = await usageSum('admin_login_failed', 'all')
    const res = await call(app, 'POST', '/api/admin/login', { json: { token: 'nope-nope-nope-nope-nope-nope' } })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
    expect((await usageSum('admin_login_failed', 'all')) - before).toBe(1)
  })

  it('answers 429 with Retry-After on the sixth attempt in an hour', async () => {
    const app = createApp()
    const ip = `adm-${randomId()}`
    for (let i = 0; i < 5; i++) expect((await call(app, 'POST', '/api/admin/login', { json: { token: 'wrong-wrong-wrong' }, ip })).status).toBe(401)
    const res = await call(app, 'POST', '/api/admin/login', { json: { token: TOKEN }, ip })
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  it('answers 413 to a chunked login body over the cap without reading all of it', async () => {
    const app = createApp()
    let pulled = 0
    const chunk = new TextEncoder().encode('x'.repeat(64))
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= 200) return controller.close()
        pulled++
        controller.enqueue(chunk)
      },
    })
    const req = new Request(`${BASE}/api/admin/login`, {
      method: 'POST',
      headers: { 'CF-Connecting-IP': randomId(), 'content-type': 'application/json', 'X-Admin': '1' },
      body: stream,
      duplex: 'half',
    } as RequestInit)
    expect(req.headers.get('content-length')).toBeNull()
    const res = await Promise.resolve(app.request(req, undefined, ENV))
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'too_large' })
    expect(pulled).toBeLessThan(200)
  })

  it('still logs in with a normal body after the cap check', async () => {
    const app = createApp()
    const res = await call(app, 'POST', '/api/admin/login', { json: { token: TOKEN } })
    expect(res.status).toBe(200)
  })

  it('rejects a tampered cookie and an expired one', async () => {
    const now = Date.now()
    const app = createApp({ now: () => now })
    const { value } = await login(app)
    expect((await call(app, 'GET', '/api/admin/overview', { cookie: value })).status).toBe(200)
    const tampered = value.slice(0, -2) + (value.endsWith('AA') ? 'BB' : 'AA')
    expect((await call(app, 'GET', '/api/admin/overview', { cookie: tampered })).status).toBe(401)
    const later = createApp({ now: () => now + 13 * HOUR })
    expect((await call(later, 'GET', '/api/admin/overview', { cookie: value })).status).toBe(401)
    expect((await call(app, 'GET', '/api/admin/overview')).status).toBe(401)
  })

  it('logout clears the cookie', async () => {
    const app = createApp()
    const res = await call(app, 'POST', '/api/admin/logout')
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toMatch(/admin_session=;/)
  })
})

describe('mutation guards', () => {
  it('refuses a POST or DELETE without X-Admin', async () => {
    const app = createApp()
    const { value } = await login(app)
    const res = await call(app, 'DELETE', '/api/admin/chats/deadbeef', { cookie: value, adminHeader: false })
    expect(res.status).toBe(403)
  })

  it('refuses a foreign Origin', async () => {
    const app = createApp()
    const { value } = await login(app)
    const res = await call(app, 'DELETE', '/api/admin/chats/deadbeef', { cookie: value, headers: { Origin: 'https://evil.example' } })
    expect(res.status).toBe(403)
  })

  it('accepts the same origin', async () => {
    const app = createApp()
    const { value } = await login(app)
    const id = await seedChat({ name: 'G', uploader: 'U', participants: ['A', 'B'] })
    const res = await call(app, 'DELETE', `/api/admin/chats/${id.slice(0, 8)}`, { cookie: value, headers: { Origin: BASE } })
    expect(res.status).toBe(200)
  })
})

describe('overview', () => {
  it('counts seeded rows, zero-fills days and groups llm calls by model', async () => {
    const app = createApp()
    const { value } = await login(app)
    const chatA = await seedChat({ name: 'Group A', uploader: 'Dana', participants: ['Ana', 'Ben'] })
    await seedChat({ name: 'Group B', uploader: null, participants: ['Cy', 'Di'], expiresAt: Date.now() - 1000 })
    const r1 = await seedReport(chatA, { status: 'done', shareId: 'share-one' })
    await seedReport(chatA, { status: 'failed', kind: 'followup', question: 'Q' })
    await seedReport(chatA)
    void r1
    await DB.batch([
      DB.prepare("INSERT INTO usage_daily (day, metric, key, count) VALUES (?, 'llm_call', 'gemini:m-a', 4), (?, 'llm_fail', 'gemini:m-a', 1), (?, 'llm_429', 'gemini:m-a', 1)").bind(today(), today(), today()),
      DB.prepare("INSERT INTO usage_daily (day, metric, key, count) VALUES (?, 'report_done', 'all', 1), (?, 'report_seconds', 'sum', 30)").bind(today(), today()),
    ])
    const res = await call(app, 'GET', '/api/admin/overview?days=7', { cookie: value })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      totals: { chatsAll: number; chatsActive: number; reportsAll: number; reportsByStatus: Record<string, number>; reportsByKind: Record<string, number>; sharedLinks: number }
      daily: { day: string; llmCalls: number; llmFails: number }[]
      llmByModel: { key: string; calls: number; fails: number; rate429: number }[]
      avgReportSeconds: number | null
    }
    expect(body.totals.chatsAll).toBe(2)
    expect(body.totals.chatsActive).toBe(1)
    expect(body.totals.reportsAll).toBe(3)
    expect(body.totals.reportsByStatus).toEqual({ queued: 1, running: 0, done: 1, failed: 1 })
    expect(body.totals.reportsByKind.followup).toBe(1)
    expect(body.totals.sharedLinks).toBe(1)
    expect(body.daily).toHaveLength(7)
    expect(body.daily[6].day).toBe(today())
    expect(body.daily[6].llmCalls).toBe(4)
    expect(body.daily[6].llmFails).toBe(1)
    expect(body.daily[0].llmCalls).toBe(0)
    expect(body.llmByModel).toEqual([{ key: 'gemini:m-a', calls: 4, fails: 1, rate429: 1 }])
    expect(body.avgReportSeconds).toBe(30)
  })

  it('returns zeros and a null average on empty tables, and clamps days', async () => {
    const app = createApp()
    const { value } = await login(app)
    const body = (await (await call(app, 'GET', '/api/admin/overview?days=9999', { cookie: value })).json()) as { daily: unknown[]; avgReportSeconds: number | null; totals: { chatsAll: number } }
    expect(body.daily).toHaveLength(90)
    expect(body.avgReportSeconds).toBeNull()
    expect(body.totals.chatsAll).toBe(0)
  })

  it('uses a fixed number of queries whatever the data size', async () => {
    const app = createApp()
    const { value } = await login(app)
    const countQueries = async () => {
      let prepares = 0
      const counting = new Proxy(DB, {
        get(target, prop) {
          if (prop === 'prepare') return (q: string) => (prepares++, target.prepare(q))
          const v = (target as unknown as Record<string | symbol, unknown>)[prop]
          return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v
        },
      })
      const res = await call(app, 'GET', '/api/admin/overview?days=30', { cookie: value, env: { ...ENV, DB: counting } as Env })
      expect(res.status).toBe(200)
      return prepares
    }
    const small = await countQueries()
    for (let i = 0; i < 20; i++) await seedReport(await seedChat({ name: `G${i}`, uploader: `U${i}`, participants: ['A', 'B'] }))
    const big = await countQueries()
    expect(big).toBe(small)
    expect(big).toBeLessThanOrEqual(6)
  })
})

describe('chats and content', () => {
  it('lists group, uploader and participant names, newest first, with a total', async () => {
    const app = createApp()
    const { value } = await login(app)
    await seedChat({ name: 'SECRET-NAME', uploader: 'SECRET-UPLOADER', participants: ['SECRET-PERSON', 'Ben'] })
    const res = await call(app, 'GET', '/api/admin/chats?limit=5', { cookie: value })
    const body = (await res.json()) as { chats: { id: string; id8: string; groupName: string; uploaderName: string; participantNames: string[]; hasShared: boolean }[]; total: number }
    expect(body.total).toBe(1)
    expect(body.chats[0]).toMatchObject({ groupName: 'SECRET-NAME', uploaderName: 'SECRET-UPLOADER', participantNames: ['SECRET-PERSON', 'Ben'], hasShared: false })
    expect(body.chats[0].id).toHaveLength(32)
    expect(body.chats[0].id8).toBe(body.chats[0].id.slice(0, 8))
  })

  it('searches case-insensitively and treats % and _ as literal characters', async () => {
    const app = createApp()
    const { value } = await login(app)
    await seedChat({ name: 'Rate 100%', uploader: 'Zed', participants: ['A', 'B'] })
    await seedChat({ name: 'Rate 1000', uploader: 'Zed', participants: ['A', 'B'] })
    await seedChat({ name: 'Snake_case', uploader: 'Mia', participants: ['A', 'B'] })
    await seedChat({ name: 'Snakexcase', uploader: 'Mia', participants: ['A', 'B'] })
    const search = async (q: string) => ((await (await call(app, 'GET', `/api/admin/chats?q=${encodeURIComponent(q)}`, { cookie: value })).json()) as { chats: { groupName: string }[] }).chats.map((c) => c.groupName)
    expect(await search('%')).toEqual(['Rate 100%'])
    expect(await search('_')).toEqual(['Snake_case'])
    expect(await search('MIA')).toHaveLength(2)
    expect(await search('ben')).toEqual([])
    expect(await search('a')).toHaveLength(4)
  })

  it('returns detail with report content, and counts the content view', async () => {
    const app = createApp()
    const { value } = await login(app)
    const id = await seedChat({ name: 'Detail group', uploader: 'Dana', participants: ['Ana', 'Ben'] })
    const reportId = await seedReport(id, { status: 'done', question: 'SECRET-QUESTION?' })
    const before = await usageSum('admin_content_view', 'all')
    const res = await call(app, 'GET', `/api/admin/chats/${id}`, { cookie: value })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { groupName: string; uploaderName: string; reports: { id: string; question: string; content: { title: string } }[] }
    expect(body.groupName).toBe('Detail group')
    expect(body.uploaderName).toBe('Dana')
    expect(body.reports[0].id).toBe(reportId)
    expect(body.reports[0].content.title).toBe('REPORT-TITLE')
    expect(body.reports[0].question).toBe('SECRET-QUESTION?')
    expect((await usageSum('admin_content_view', 'all')) - before).toBe(1)
  })

  it('returns one chunk of messages page by page and the chunk count', async () => {
    const app = createApp()
    const { value } = await login(app)
    const id = await seedChat({ name: 'Paged', uploader: 'Dana', participants: ['Ana', 'Ben'] })
    const res = await call(app, 'GET', `/api/admin/chats/${id.slice(0, 8)}/messages?chunk=0`, { cookie: value })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { chunk: number; chunks: number; text: string }
    expect(body.chunk).toBe(0)
    expect(body.chunks).toBe(1)
    expect(body.text).toContain('SECRET-TEXT')
    expect((await call(app, 'GET', `/api/admin/chats/${id}/messages?chunk=7`, { cookie: value })).status).toBe(404)
  })

  it('groups uploaders by the lower-cased cleaned name', async () => {
    const app = createApp()
    const { value } = await login(app)
    await seedChat({ name: 'One', uploader: 'dana levi', participants: ['A', 'B'] })
    await seedChat({ name: 'Two', uploader: 'Dana Levi', participants: ['A', 'B'] })
    await seedChat({ name: 'Three', uploader: null, participants: ['A', 'B'] })
    const body = (await (await call(app, 'GET', '/api/admin/uploaders', { cookie: value })).json()) as { uploaders: { uploaderName: string; chats: number }[] }
    const dana = body.uploaders.find((u) => u.uploaderName === 'dana levi')
    expect(dana?.chats).toBe(2)
    expect(body.uploaders.find((u) => u.uploaderName === 'unknown')?.chats).toBe(1)
  })

  it('answers 404 for an unknown id and 409 for an ambiguous prefix', async () => {
    const app = createApp()
    const { value } = await login(app)
    expect((await call(app, 'GET', '/api/admin/chats/abcdef12', { cookie: value })).status).toBe(404)
    await seedChat({ name: 'X', uploader: 'U', participants: ['A', 'B'], id: `cafe0001${'a'.repeat(24)}` })
    await seedChat({ name: 'Y', uploader: 'U', participants: ['A', 'B'], id: `cafe0001${'b'.repeat(24)}` })
    expect((await call(app, 'GET', '/api/admin/chats/cafe0001', { cookie: value })).status).toBe(409)
    expect((await call(app, 'GET', `/api/admin/chats/cafe0001${'a'.repeat(24)}`, { cookie: value })).status).toBe(200)
  })

  it('shows names and text only behind a session', async () => {
    const app = createApp()
    const { value } = await login(app)
    const id = await seedChat({ name: 'SECRET-NAME', uploader: 'SECRET-UPLOADER', participants: ['SECRET-PERSON', 'Ben'] })
    await seedReport(id, { status: 'done' })
    const withSession = await (await call(app, 'GET', `/api/admin/chats/${id.slice(0, 8)}`, { cookie: value })).text()
    const messages = await (await call(app, 'GET', `/api/admin/chats/${id.slice(0, 8)}/messages`, { cookie: value })).text()
    for (const s of ['SECRET-NAME', 'SECRET-UPLOADER', 'SECRET-PERSON']) expect(withSession).toContain(s)
    expect(messages).toContain('SECRET-TEXT')
    const without = await call(app, 'GET', `/api/admin/chats/${id.slice(0, 8)}`)
    const withoutBody = await without.text()
    expect(without.status).toBe(401)
    for (const s of ['SECRET-NAME', 'SECRET-UPLOADER', 'SECRET-PERSON', 'SECRET-TEXT']) expect(withoutBody).not.toContain(s)
  })
})

describe('mutations', () => {
  it('deletes a chat, a report and unshares, and 404s afterwards', async () => {
    const app = createApp()
    const { value } = await login(app)
    const chatId = await seedChat({ name: 'Gone', uploader: 'U', participants: ['A', 'B'] })
    const reportId = await seedReport(chatId, { status: 'done', shareId: 'share-two' })
    const unshare = await call(app, 'POST', `/api/admin/reports/${reportId.slice(0, 8)}/unshare`, { cookie: value })
    expect(unshare.status).toBe(200)
    expect(await count('SELECT COUNT(*) AS n FROM reports WHERE share_id IS NOT NULL')).toBe(0)
    expect((await call(app, 'DELETE', `/api/admin/reports/${reportId.slice(0, 8)}`, { cookie: value })).status).toBe(200)
    expect((await call(app, 'DELETE', `/api/admin/reports/${reportId.slice(0, 8)}`, { cookie: value })).status).toBe(404)
    expect((await call(app, 'DELETE', `/api/admin/chats/${chatId.slice(0, 8)}`, { cookie: value })).status).toBe(200)
    expect(await count('SELECT COUNT(*) AS n FROM chats WHERE id = ?', chatId)).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM chat_chunks WHERE chat_id = ?', chatId)).toBe(0)
    expect((await call(app, 'DELETE', `/api/admin/chats/${chatId.slice(0, 8)}`, { cookie: value })).status).toBe(404)
  })

  it('answers 409 when a report prefix is ambiguous', async () => {
    const app = createApp()
    const { value } = await login(app)
    const chatId = await seedChat({ name: 'R', uploader: 'U', participants: ['A', 'B'] })
    await DB.batch([
      DB.prepare("INSERT INTO reports (id, chat_id, persona, language, me, kind, status, progress, total, created_at) VALUES (?, ?, 'clara', 'English', 'Ana', 'group', 'queued', 0, 1, 1)").bind(`beef0002${'1'.repeat(24)}`, chatId),
      DB.prepare("INSERT INTO reports (id, chat_id, persona, language, me, kind, status, progress, total, created_at) VALUES (?, ?, 'clara', 'English', 'Ana', 'group', 'queued', 0, 1, 1)").bind(`beef0002${'2'.repeat(24)}`, chatId),
    ])
    expect((await call(app, 'DELETE', '/api/admin/reports/beef0002', { cookie: value })).status).toBe(409)
  })
})

describe('public routes stay as they were', () => {
  it('never return the uploader name, and no report view carries participant names', async () => {
    const provider = fakeProvider(defaultReply)
    const app = createApp({ provider })
    const ip = `pub-${randomId()}`
    const uploadRes = await call(app, 'POST', '/api/chats', {
      json: { ...uploadBody(chatWith(40, ['SECRET-PERSON', 'Ben'])), uploaderName: 'SECRET-UPLOADER' },
      ip,
    })
    const uploadText = await uploadRes.text()
    expect(uploadRes.status).toBe(201)
    const chatId = (JSON.parse(uploadText) as { chatId: string }).chatId
    const reportRes = await call(app, 'POST', `/api/chats/${chatId}/reports`, {
      json: { persona: 'brandon', language: 'English', me: 'SECRET-PERSON', kind: 'group' },
      ip,
    })
    const reportId = ((await reportRes.json()) as { reportId: string }).reportId
    const advanced = await call(app, 'POST', `/api/reports/${reportId}/advance`, { ip })
    const advancedText = await advanced.text()
    const view = await call(app, 'GET', `/api/reports/${reportId}`, { ip })
    const viewText = await view.text()
    await createDb(DB).setShare(reportId, 'publicshare0123456789abcdef0123')
    const shared = await call(app, 'GET', '/api/shared/publicshare0123456789abcdef0123', { ip })
    const sharedText = await shared.text()
    for (const text of [uploadText, advancedText, viewText, sharedText]) expect(text).not.toContain('SECRET-UPLOADER')
    expect(viewText).not.toContain('SECRET-PERSON')
    expect(sharedText).not.toContain('SECRET-PERSON')
    expect(sharedText).not.toContain('SECRET-UPLOADER')
  })
})

