import { env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { createApp, scheduled, type Env } from '../../src/worker/index'
import { RateLimitError } from '../../src/llm/provider'
import { dayOf, bump } from '../../src/worker/usage'
import { randomId } from '../../src/worker/db'
import { applyMigrations, chatWith, defaultReply, fakeProvider, uploadBody } from './support'

const ENV = env as unknown as Env
const DB = ENV.DB

beforeAll(async () => {
  await applyMigrations(DB)
})

// Each test uses its own client IP, so per-IP limits and visitor counts do not leak between tests.
const today = () => dayOf(Date.now())

async function total(metric: string, key?: string): Promise<number> {
  const row = key === undefined
    ? await DB.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM usage_daily WHERE day = ? AND metric = ?').bind(today(), metric).first<{ n: number }>()
    : await DB.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM usage_daily WHERE day = ? AND metric = ? AND key = ?').bind(today(), metric, key).first<{ n: number }>()
  return row?.n ?? 0
}

async function visitors(): Promise<number> {
  const row = await DB.prepare('SELECT COUNT(*) AS n FROM visitors WHERE day = ?').bind(today()).first<{ n: number }>()
  return row?.n ?? 0
}

const post = (app: ReturnType<typeof createApp>, path: string, body: unknown, ip: string, envOverride: Env = ENV) =>
  Promise.resolve(
    app.request(path, { method: 'POST', headers: { 'CF-Connecting-IP': ip, 'content-type': 'application/json' }, body: JSON.stringify(body) }, envOverride),
  )

async function uploadChat(app: ReturnType<typeof createApp>, ip: string, envOverride: Env = ENV): Promise<string> {
  const res = await post(app, '/api/chats', uploadBody(chatWith(40)), ip, envOverride)
  expect(res.status).toBe(201)
  return ((await res.json()) as { chatId: string }).chatId
}

async function reportFor(app: ReturnType<typeof createApp>, chatId: string, ip: string, envOverride: Env = ENV): Promise<string> {
  const res = await post(app, `/api/chats/${chatId}/reports`, { persona: 'brandon', language: 'English', me: 'Ana', kind: 'group' }, ip, envOverride)
  expect(res.status).toBe(201)
  return ((await res.json()) as { reportId: string }).reportId
}

async function advance(app: ReturnType<typeof createApp>, reportId: string, envOverride: Env = ENV) {
  const res = await Promise.resolve(app.request(`/api/reports/${reportId}/advance`, { method: 'POST', headers: { 'CF-Connecting-IP': randomId() } }, envOverride))
  return { status: res.status, body: (await res.json()) as { status: string; error?: string } }
}

describe('upload and report counters', () => {
  it('counts uploads, upload size and a visitor once per day', async () => {
    const app = createApp()
    const ip = `cnt-${randomId()}`
    const beforeUploads = await total('upload', 'all')
    const beforeBytes = await total('upload_bytes', 'all')
    const beforeVisitors = await visitors()
    await uploadChat(app, ip)
    await uploadChat(app, ip)
    expect((await total('upload', 'all')) - beforeUploads).toBe(2)
    expect((await total('upload_bytes', 'all')) - beforeBytes).toBeGreaterThanOrEqual(2)
    expect((await visitors()) - beforeVisitors).toBe(1)
  })

  it('counts a created report by kind and the visitor', async () => {
    const app = createApp()
    const ip = `cnt-${randomId()}`
    const chatId = await uploadChat(app, ip)
    const before = await total('report_created', 'group')
    await reportFor(app, chatId, ip)
    expect((await total('report_created', 'group')) - before).toBe(1)
  })

  it('counts a refused request under rate_limited with its bucket', async () => {
    const app = createApp()
    const ip = `cnt-${randomId()}`
    for (let i = 0; i < 10; i++) expect((await post(app, '/api/chats', uploadBody(chatWith(40)), ip)).status).toBe(201)
    const before = await total('rate_limited', 'chat')
    expect((await post(app, '/api/chats', uploadBody(chatWith(40)), ip)).status).toBe(429)
    expect((await total('rate_limited', 'chat')) - before).toBe(1)
  })
})

describe('job counters', () => {
  it('counts each LLM attempt, failures and the done report with its seconds', async () => {
    const model = `m-${randomId()}`
    const base = fakeProvider((req, n) => {
      if (n === 1) throw new Error('upstream down')
      return defaultReply(req)
    })
    const provider = Object.assign(base, { name: 'gemini', model })
    const app = createApp({ provider })
    const ip = `cnt-${randomId()}`
    const chatId = await uploadChat(app, ip)
    const reportId = await reportFor(app, chatId, ip)

    const doneBefore = await total('report_done', 'all')
    const secBefore = await total('report_seconds', 'sum')
    let state = await advance(app, reportId)
    for (let i = 0; i < 6 && state.body.status !== 'done'; i++) state = await advance(app, reportId)
    expect(state.body.status).toBe('done')

    expect(await total('llm_call', `gemini:${model}`)).toBe(3)
    expect(await total('llm_fail', `gemini:${model}`)).toBe(1)
    expect(await total('llm_429', `gemini:${model}`)).toBe(0)
    expect((await total('report_done', 'all')) - doneBefore).toBe(1)
    expect((await total('report_seconds', 'sum')) - secBefore).toBeGreaterThanOrEqual(0)
  })

  it('counts a rate limited call under llm_429', async () => {
    const model = `m-${randomId()}`
    const base = fakeProvider((req, n) => {
      if (n === 1) throw new RateLimitError('slow')
      return defaultReply(req)
    })
    const app = createApp({ provider: Object.assign(base, { name: 'openrouter', model }) })
    const ip = `cnt-${randomId()}`
    const reportId = await reportFor(app, await uploadChat(app, ip), ip)
    await advance(app, reportId)
    expect(await total('llm_429', `openrouter:${model}`)).toBe(1)
    expect(await total('llm_fail', `openrouter:${model}`)).toBe(1)
  })

  it('counts a failed report once, when the failure limit is reached', async () => {
    const model = `m-${randomId()}`
    const base = fakeProvider(() => {
      throw new Error('always down')
    })
    const app = createApp({ provider: Object.assign(base, { name: 'gemini', model }) })
    const ip = `cnt-${randomId()}`
    const reportId = await reportFor(app, await uploadChat(app, ip), ip)
    const before = await total('report_failed', 'all')
    let state = await advance(app, reportId)
    for (let i = 0; i < 10 && state.body.status !== 'failed'; i++) state = await advance(app, reportId)
    expect(state.body.status).toBe('failed')
    await advance(app, reportId)
    expect((await total('report_failed', 'all')) - before).toBe(1)
  })

  it('a failing usage database never breaks the upload or the report job', async () => {
    const app = createApp({ provider: fakeProvider(defaultReply) })
    const ip = `cnt-${randomId()}`
    const chatId = await uploadChat(app, ip)
    const reportId = await reportFor(app, chatId, ip)
    const broken = new Proxy(DB, {
      get(target, prop) {
        if (prop === 'prepare') {
          return (q: string) => {
            if (/usage_daily|visitors/.test(q)) throw new Error('usage table down')
            return target.prepare(q)
          }
        }
        const v = (target as unknown as Record<string | symbol, unknown>)[prop]
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v
      },
    })
    const brokenEnv = { ...ENV, DB: broken } as Env
    expect((await post(app, '/api/chats', uploadBody(chatWith(40)), `cnt-${randomId()}`, brokenEnv)).status).toBe(201)
    let state = await advance(app, reportId, brokenEnv)
    expect(state.status).toBe(200)
    for (let i = 0; i < 6 && state.body.status !== 'done'; i++) state = await advance(app, reportId, brokenEnv)
    expect(state.body.status).toBe('done')
  })
})

describe('scheduled cleanup', () => {
  it('prunes usage rows older than 90 days', async () => {
    const old = dayOf(Date.now() - 120 * 86_400_000)
    await bump(DB, old, 'upload', 'all')
    await scheduled({} as ScheduledController, ENV, {} as ExecutionContext)
    const row = await DB.prepare('SELECT COUNT(*) AS n FROM usage_daily WHERE day = ?').bind(old).first<{ n: number }>()
    expect(row?.n).toBe(0)
  })
})
