import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import worker, { createApp, type Env } from '../../src/worker/index'
import { createDb, randomId } from '../../src/worker/db'
import { RateLimitError } from '../../src/llm/provider'
import { chunkMessages } from '../../src/pipeline/chunk'
import { applyMigrations, chatWith, defaultReply, fakeProvider, isSummaryCall, reportJson, uploadBody } from './support'

const ENV = env as unknown as Env
const HEX32 = /^[0-9a-f]{32}$/
const MB = 1024 * 1024

beforeAll(async () => {
  await applyMigrations(ENV.DB)
})

// Each test gets its own client IP so per-IP rate limits do not leak between tests.
let currentIp = ''
beforeEach(() => {
  currentIp = `test-${randomId()}`
})

type App = ReturnType<typeof createApp>
interface Opts {
  json?: unknown
  raw?: string
  headers?: Record<string, string>
  ip?: string
}

function send(app: App, method: string, path: string, opts: Opts = {}): Promise<Response> {
  const headers: Record<string, string> = { 'CF-Connecting-IP': opts.ip ?? currentIp, ...(opts.headers ?? {}) }
  let body: string | undefined
  if (opts.json !== undefined) body = JSON.stringify(opts.json)
  if (opts.raw !== undefined) body = opts.raw
  if (body !== undefined) headers['content-type'] = 'application/json'
  return Promise.resolve(app.request(path, { method, headers, body }, ENV))
}

interface AdvanceBody {
  status: string
  phase: string
  progress: number
  total: number
  error?: string
}
interface ReportBody {
  id?: string
  status: string
  progress: number
  total: number
  persona: string
  language: string
  kind: string
  subject: string | null
  error: string | null
  content?: {
    members: { name: string; quote?: string }[]
    sections: { body: string }[]
  }
}

async function uploadChat(app: App, chatBody: ReturnType<typeof uploadBody>, ip?: string) {
  const res = await send(app, 'POST', '/api/chats', { json: chatBody, ip })
  expect(res.status).toBe(201)
  return (await res.json()) as { chatId: string; name: string; participants: string[]; stats: { total: number } }
}

async function createReport(app: App, chatId: string, over: Record<string, unknown> = {}, ip?: string): Promise<string> {
  const res = await send(app, 'POST', `/api/chats/${chatId}/reports`, {
    ip,
    json: { persona: 'brandon', language: 'English', me: 'Ana', kind: 'group', ...over },
  })
  expect(res.status).toBe(201)
  return ((await res.json()) as { reportId: string }).reportId
}

async function advance(app: App, reportId: string): Promise<AdvanceBody> {
  const res = await send(app, 'POST', `/api/reports/${reportId}/advance`)
  expect(res.status).toBe(200)
  return (await res.json()) as AdvanceBody
}

async function advanceUntilDone(app: App, reportId: string, max = 60): Promise<AdvanceBody> {
  let last: AdvanceBody | undefined
  for (let i = 0; i < max; i++) {
    last = await advance(app, reportId)
    if (last.status === 'done' || last.status === 'failed') break
  }
  return last!
}

async function getReport(app: App, reportId: string): Promise<ReportBody> {
  const res = await send(app, 'GET', `/api/reports/${reportId}`)
  expect(res.status).toBe(200)
  return (await res.json()) as ReportBody
}

describe('POST /api/chats (upload)', () => {
  it('upload accepts a valid JSON chat and returns participants', async () => {
    const provider = fakeProvider()
    const app = createApp({ provider })
    const body = uploadBody(chatWith(40))
    const res = await send(app, 'POST', '/api/chats', { json: body })
    expect(res.status).toBe(201)
    const json = (await res.json()) as { chatId: string; name: string; participants: string[]; stats: Record<string, number> }
    expect(json.chatId).toMatch(HEX32)
    expect(json.name).toBe('Test group')
    expect(json.participants).toEqual(['Ana', 'Ben'])
    expect(json.stats).toEqual({ total: 40, days: body.stats.days, firstTs: body.stats.firstTs, lastTs: body.stats.lastTs })
    expect(provider.calls).toHaveLength(0)
  })

  it('rejects a body over 10 MB with 413 when the content-length header says so', async () => {
    const app = createApp({ provider: fakeProvider() })
    const res = await send(app, 'POST', '/api/chats', { raw: '{}', headers: { 'content-length': String(10 * MB + 1) } })
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'too_large' })
  })

  it('rejects a body over 10 MB with 413 by its actual size', async () => {
    const app = createApp({ provider: fakeProvider() })
    const res = await send(app, 'POST', '/api/chats', { raw: 'a'.repeat(10 * MB + 1) })
    expect(res.status).toBe(413)
  })

  it('rejects too_small with 422 and never calls the provider', async () => {
    const provider = fakeProvider()
    const app = createApp({ provider })
    const small = await send(app, 'POST', '/api/chats', { json: uploadBody(chatWith(10)) })
    expect(small.status).toBe(422)
    expect(await small.json()).toEqual({ error: 'too_small' })

    const solo = await send(app, 'POST', '/api/chats', { json: uploadBody(chatWith(40, ['Ana'])) })
    expect(solo.status).toBe(422)
    expect(provider.calls).toHaveLength(0)
  })

  it('rejects malformed or forged stats and bad shapes with 400 bad_request', async () => {
    const app = createApp({ provider: fakeProvider() })
    const good = uploadBody(chatWith(40))
    const cases: [string, string][] = [
      ['NaN in a number', JSON.stringify(good).replace('"total":40', '"total":NaN')],
      ['string number', JSON.stringify({ ...good, stats: { ...good.stats, total: '40' } })],
      ['perMember key not a participant', JSON.stringify({ ...good, stats: { ...good.stats, perMember: { ...good.stats.perMember, Zed: good.stats.perMember.Ana } } })],
      ['__proto__ key not a participant', JSON.stringify(good).replace('"perMember":{', `"perMember":{"__proto__":${JSON.stringify(good.stats.perMember.Ana)},`)],
      ['short histogram', JSON.stringify({ ...good, stats: { ...good.stats, hourHistogram: [1, 2, 3] } })],
      ['fractional busiestHour', JSON.stringify({ ...good, stats: { ...good.stats, perMember: { Ana: { ...good.stats.perMember.Ana, busiestHour: 1.5 }, Ben: good.stats.perMember.Ben } } })],
      ['non-contiguous chunk index', JSON.stringify({ ...good, chunks: good.chunks.map((c) => ({ ...c, index: c.index + 1 })) })],
      ['duplicate participants', JSON.stringify({ ...good, participants: ['Ana', 'Ana'] })],
      ['empty chunk text', JSON.stringify({ ...good, chunks: [{ index: 0, fromId: 0, toId: 1, text: '' }] })],
      ['name too long', JSON.stringify({ ...good, name: 'x'.repeat(81) })],
      ['not json', 'not json at all'],
    ]
    for (const [i, [label, raw]] of cases.entries()) {
      // one IP per case, so the 10-per-hour upload limit does not mask the validation result
      const res = await send(app, 'POST', '/api/chats', { raw, ip: `${currentIp}-${i}` })
      expect(res.status, label).toBe(400)
      expect(await res.json(), label).toEqual({ error: 'bad_request' })
    }
  })

  it('a participant named "__proto__" works end to end', async () => {
    const provider = fakeProvider((req) => (isSummaryCall(req) ? defaultReply(req) : reportJson({ memberName: '__proto__' })))
    const app = createApp({ provider })
    const chat = await uploadChat(app, uploadBody(chatWith(40, ['__proto__', 'Ben'])))
    expect(chat.participants).toEqual(['__proto__', 'Ben'])

    const reportId = await createReport(app, chat.chatId, { me: '__proto__', kind: 'group' })
    const done = await advanceUntilDone(app, reportId)
    expect(done.status).toBe('done')
    const report = await getReport(app, reportId)
    expect(report.content?.members.map((m) => m.name)).toEqual(['__proto__', 'Ben'])
  })
})

describe('POST /api/chats/:id/reports', () => {
  it('creating a report for a missing or expired chat is 404', async () => {
    const app = createApp({ provider: fakeProvider() })
    const missing = await send(app, 'POST', `/api/chats/${'a'.repeat(32)}/reports`, {
      json: { persona: 'brandon', language: 'English', me: 'Ana', kind: 'group' },
    })
    expect(missing.status).toBe(404)

    const db = createDb(ENV.DB)
    const expired = await db.insertChat({
      name: 'old',
      participants: ['Ana', 'Ben'],
      stats: uploadBody(chatWith(40)).stats,
      chunks: chunkMessages(chatWith(40)),
      expiresAt: Date.now() - 1,
    })
    const res = await send(app, 'POST', `/api/chats/${expired}/reports`, {
      json: { persona: 'brandon', language: 'English', me: 'Ana', kind: 'group' },
    })
    expect(res.status).toBe(404)
  })

  it('validates persona, language, me and subject; followup returns unsupported_kind', async () => {
    const app = createApp({ provider: fakeProvider() })
    const chat = await uploadChat(app, uploadBody(chatWith(40)))
    const base = { persona: 'brandon', language: 'English', me: 'Ana', kind: 'group' }
    const bad: Record<string, unknown>[] = [
      { ...base, persona: 'nobody' },
      { ...base, language: 'E' },
      { ...base, language: 'English<script>' },
      { ...base, me: 'Stranger' },
      { ...base, kind: 'member' },
      { ...base, kind: 'member', subject: 'Stranger' },
    ]
    for (const b of bad) {
      const res = await send(app, 'POST', `/api/chats/${chat.chatId}/reports`, { json: b })
      expect(res.status, JSON.stringify(b)).toBe(400)
    }

    const followup = await send(app, 'POST', `/api/chats/${chat.chatId}/reports`, { json: { ...base, kind: 'followup', question: 'why?' } })
    expect(followup.status).toBe(400)
    expect(await followup.json()).toEqual({ error: 'unsupported_kind' })

    const hebrew = await send(app, 'POST', `/api/chats/${chat.chatId}/reports`, { json: { ...base, language: 'עברית' } })
    expect(hebrew.status).toBe(201)
  })

  it('rate limit returns 429 with Retry-After after 30 report creates per hour per IP', async () => {
    const app = createApp({ provider: fakeProvider() })
    const chat = await uploadChat(app, uploadBody(chatWith(40)))
    const ip = `ip-${randomId()}`
    for (let i = 0; i < 30; i++) await createReport(app, chat.chatId, {}, ip)
    const res = await send(app, 'POST', `/api/chats/${chat.chatId}/reports`, {
      ip,
      json: { persona: 'brandon', language: 'English', me: 'Ana', kind: 'group' },
    })
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate_limited' })
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
  })
})

describe('advance', () => {
  it('advance summarizes one chunk per call, then reports, then done (provider call count)', async () => {
    const provider = fakeProvider()
    const app = createApp({ provider })
    const chat = chatWith(40)
    const n = chunkMessages(chat, 400).length
    expect(n).toBeGreaterThan(2)
    const up = await uploadChat(app, uploadBody(chat, 400))
    const reportId = await createReport(app, up.chatId)
    expect((await getReport(app, reportId)).total).toBe(n + 1)

    for (let i = 1; i <= n; i++) {
      const state = await advance(app, reportId)
      expect(state).toMatchObject({ status: 'running', phase: i < n ? 'summarizing' : 'reporting', progress: i, total: n + 1 })
      expect(provider.calls).toHaveLength(i)
    }
    const reporting = await advance(app, reportId)
    expect(reporting).toMatchObject({ status: 'done', phase: 'done', progress: n + 1, total: n + 1 })
    expect(provider.calls).toHaveLength(n + 1)
    expect(provider.calls.slice(0, n).every(isSummaryCall)).toBe(true)
    expect(isSummaryCall(provider.calls[n])).toBe(false)

    // A done report is returned as is, with no LLM call.
    expect(await advance(app, reportId)).toMatchObject({ status: 'done' })
    expect(provider.calls).toHaveLength(n + 1)
  })

  it('a RateLimitError leaves the job resumable and a later advance continues from the same chunk', async () => {
    const chat = chatWith(40)
    const chunks = chunkMessages(chat, 400)
    const provider = fakeProvider((req, call) => {
      if (call === 2) throw new RateLimitError('slow down')
      return defaultReply(req)
    })
    const app = createApp({ provider })
    const up = await uploadChat(app, uploadBody(chat, 400))
    const reportId = await createReport(app, up.chatId)

    expect(await advance(app, reportId)).toMatchObject({ status: 'running', progress: 1 })
    const limited = await advance(app, reportId)
    expect(limited).toMatchObject({ status: 'running', progress: 1, error: 'rate_limited' })
    const resumed = await advance(app, reportId)
    expect(resumed).toMatchObject({ status: 'running', progress: 2 })
    expect(resumed.error).toBeUndefined()

    // the third call summarised chunk 1 (the one that failed), not chunk 2
    expect(provider.calls[2].prompt).toContain(chunks[1].text)
    expect(provider.calls[2].prompt).not.toContain(chunks[2].text)
    expect((await getReport(app, reportId)).error).toBeNull()
  })

  it('invalid JSON from the model retries then records the error, and 5 consecutive failures set failed', async () => {
    const provider = fakeProvider((req) => (isSummaryCall(req) ? defaultReply(req) : 'this is not json'))
    const app = createApp({ provider })
    const up = await uploadChat(app, uploadBody(chatWith(40), 100_000))
    const reportId = await createReport(app, up.chatId)

    expect(await advance(app, reportId)).toMatchObject({ status: 'running', progress: 1 })
    for (let failure = 1; failure <= 4; failure++) {
      expect(await advance(app, reportId)).toMatchObject({ status: 'running', error: 'llm_error' })
      expect((await getReport(app, reportId)).status).toBe('running')
    }
    expect(await advance(app, reportId)).toMatchObject({ status: 'failed', phase: 'failed', error: 'llm_error' })
    expect(provider.calls).toHaveLength(1 + 5 * 2) // each report attempt is a call plus one repair retry

    // a failed report makes no further LLM calls
    expect(await advance(app, reportId)).toMatchObject({ status: 'failed' })
    expect(provider.calls).toHaveLength(11)
    expect((await createDb(ENV.DB).getReport(reportId))?.failures).toBe(5)
  })

  it('second report on the same chat reuses stored summaries (provider call count)', async () => {
    const provider = fakeProvider()
    const app = createApp({ provider })
    const chat = chatWith(40)
    const n = chunkMessages(chat, 400).length
    const up = await uploadChat(app, uploadBody(chat, 400))

    const first = await createReport(app, up.chatId)
    await advanceUntilDone(app, first)
    expect(provider.calls).toHaveLength(n + 1)

    const second = await createReport(app, up.chatId, { persona: 'clara' })
    expect(await advance(app, second)).toMatchObject({ status: 'done', phase: 'done', progress: n + 1 })
    expect(provider.calls).toHaveLength(n + 2)
    expect(isSummaryCall(provider.calls[n + 1])).toBe(false)
  })

  it('quotes not in the chat are dropped from the final report', async () => {
    const app = createApp({ provider: fakeProvider() })
    const up = await uploadChat(app, uploadBody(chatWith(40)))
    const reportId = await createReport(app, up.chatId)
    await advanceUntilDone(app, reportId)
    const report = await getReport(app, reportId)
    expect(report.status).toBe('done')
    expect(report.content?.members[0].quote).toBe('hello there')
    expect(report.content?.members[1].quote).toBeUndefined()
    const body = report.content?.sections[0].body ?? ''
    expect(body).toContain('> hello there')
    expect(body).not.toContain('invented')
  })

  it('without a configured LLM key the advance route answers 503 llm_not_configured', async () => {
    const app = createApp()
    const up = await uploadChat(app, uploadBody(chatWith(40)))
    const reportId = await createReport(app, up.chatId)
    const res = await send(app, 'POST', `/api/reports/${reportId}/advance`)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'llm_not_configured' })
  })
})

describe('reports, sharing and deletion', () => {
  it('share link works until revoked, then 404', async () => {
    const app = createApp({ provider: fakeProvider() })
    const up = await uploadChat(app, uploadBody(chatWith(40)))
    const reportId = await createReport(app, up.chatId, { persona: 'diego' })
    await advanceUntilDone(app, reportId)

    const shared = await send(app, 'POST', `/api/reports/${reportId}/share`)
    expect(shared.status).toBe(200)
    const { shareId } = (await shared.json()) as { shareId: string }
    expect(shareId).toMatch(HEX32)

    const view = await send(app, 'GET', `/api/shared/${shareId}`)
    expect(view.status).toBe(200)
    const body = (await view.json()) as { groupName: string; persona: string; content: { members: unknown[] } }
    expect(body.groupName).toBe('Test group')
    expect(body.persona).toBe('diego')
    expect(body.content.members.length).toBeGreaterThan(0)

    expect((await send(app, 'DELETE', `/api/reports/${reportId}/share`)).status).toBe(200)
    expect((await send(app, 'GET', `/api/shared/${shareId}`)).status).toBe(404)
  })

  it('a shared link for an expired chat is 404, and a shared link for an unfinished report is 404', async () => {
    const app = createApp({ provider: fakeProvider() })
    const up = await uploadChat(app, uploadBody(chatWith(40)))
    const unfinished = await createReport(app, up.chatId)
    const pending = (await (await send(app, 'POST', `/api/reports/${unfinished}/share`)).json()) as { shareId: string }
    expect((await send(app, 'GET', `/api/shared/${pending.shareId}`)).status).toBe(404)

    const reportId = await createReport(app, up.chatId)
    await advanceUntilDone(app, reportId)
    const { shareId } = (await (await send(app, 'POST', `/api/reports/${reportId}/share`)).json()) as { shareId: string }
    expect((await send(app, 'GET', `/api/shared/${shareId}`)).status).toBe(200)

    await ENV.DB.prepare('UPDATE chats SET expires_at = ? WHERE id = ?').bind(1, up.chatId).run()
    expect((await send(app, 'GET', `/api/shared/${shareId}`)).status).toBe(404)
    expect((await send(app, 'GET', `/api/reports/${reportId}`)).status).toBe(404)
  })

  it('deleting a report or a chat makes it 404', async () => {
    const app = createApp({ provider: fakeProvider() })
    const up = await uploadChat(app, uploadBody(chatWith(40)))
    const r1 = await createReport(app, up.chatId)
    expect((await send(app, 'DELETE', `/api/reports/${r1}`)).status).toBe(200)
    expect((await send(app, 'GET', `/api/reports/${r1}`)).status).toBe(404)

    expect((await send(app, 'DELETE', `/api/chats/${up.chatId}`)).status).toBe(200)
    expect((await send(app, 'POST', `/api/chats/${up.chatId}/reports`, {
      json: { persona: 'brandon', language: 'English', me: 'Ana', kind: 'group' },
    })).status).toBe(404)
  })

  it('scheduled() deletes expired chats and old rate rows', async () => {
    const db = createDb(ENV.DB)
    const stats = uploadBody(chatWith(40)).stats
    const expired = await db.insertChat({ name: 'gone', participants: ['Ana', 'Ben'], stats, chunks: chunkMessages(chatWith(40)), expiresAt: Date.now() - 1000 })
    const fresh = await db.insertChat({ name: 'kept', participants: ['Ana', 'Ben'], stats, chunks: chunkMessages(chatWith(40)), expiresAt: Date.now() + 60_000 })
    await ENV.DB.prepare('INSERT INTO rate (key, "window", count) VALUES (?, ?, 1)').bind('old:x', 1).run()

    await worker.scheduled({} as ScheduledController, ENV, {} as ExecutionContext)

    const left = await ENV.DB.prepare('SELECT COUNT(*) AS n FROM chats WHERE id = ?').bind(expired).first<{ n: number }>()
    expect(left?.n).toBe(0)
    const kept = await ENV.DB.prepare('SELECT COUNT(*) AS n FROM chats WHERE id = ?').bind(fresh).first<{ n: number }>()
    expect(kept?.n).toBe(1)
    const rate = await ENV.DB.prepare('SELECT COUNT(*) AS n FROM rate WHERE key = ?').bind('old:x').first<{ n: number }>()
    expect(rate?.n).toBe(0)
  })

  it('response headers are present on every /api response, including errors', async () => {
    const app = createApp({ provider: fakeProvider() })
    for (const res of [
      await send(app, 'GET', '/api/health'),
      await send(app, 'GET', `/api/reports/${'z'.repeat(32)}`),
      await send(app, 'GET', '/api/nope'),
    ]) {
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
    }
  })

  it('malformed ids are 404 and never reach the database', async () => {
    const app = createApp({ provider: fakeProvider() })
    const bad = ['xyz', 'A'.repeat(32), '0'.repeat(31), '0'.repeat(33), '../../etc']
    for (const id of bad) {
      expect((await send(app, 'GET', `/api/reports/${id}`)).status, id).toBe(404)
      expect((await send(app, 'DELETE', `/api/chats/${id}`)).status, id).toBe(404)
      expect((await send(app, 'GET', `/api/shared/${id}`)).status, id).toBe(404)
      expect((await send(app, 'POST', `/api/reports/${id}/advance`)).status, id).toBe(404)
    }
  })

  it('rate limits are independent per IP', async () => {
    const app = createApp({ provider: fakeProvider() })
    const ipA = `ip-a-${randomId()}`
    const ipB = `ip-b-${randomId()}`
    for (let i = 0; i < 10; i++) {
      expect((await send(app, 'POST', '/api/chats', { json: uploadBody(chatWith(40)), ip: ipA })).status).toBe(201)
    }
    expect((await send(app, 'POST', '/api/chats', { json: uploadBody(chatWith(40)), ip: ipA })).status).toBe(429)
    expect((await send(app, 'POST', '/api/chats', { json: uploadBody(chatWith(40)), ip: ipB })).status).toBe(201)
  })
})
