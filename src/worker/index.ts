import { Hono, type Context } from 'hono'
import type { LlmProvider } from '../llm/provider'
import { advanceReport } from './jobs'
import { createDb, randomId, type ReportRow } from './db'
import { checkRateLimit, deleteOldRateRows, hashIp, ipBucketKey, retryAfterSeconds } from './ratelimit'
import { ApiError, MAX_UPLOAD_BYTES, validateUpload } from './validate'

export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  GEMINI_API_KEY?: string
  OPENROUTER_API_KEY?: string
  OPENROUTER_MODEL?: string
  LLM_PRIMARY?: 'gemini' | 'openrouter'
}

export interface AppDeps {
  /** Overrides the provider chain built from env (tests). */
  provider?: LlmProvider
  /** Clock in ms (tests). */
  now?: () => number
}

const CHAT_TTL_MS = 30 * 24 * 60 * 60 * 1000
const SMALL_JSON_BYTES = 16 * 1024
const LIMITS = { createChat: 10, createReport: 30, advance: 600 }
const HEX32 = /^[0-9a-f]{32}$/
/** Letters, combining marks, spaces, brackets and hyphens, 2 to 40 characters. Linear. */
const LANGUAGE = /^[\p{L}\p{M} ()-]{2,40}$/u
const PERSONAS = new Set(['brandon', 'clara', 'diego'])

const isId = (s: string) => HEX32.test(s)
const notFound = () => new ApiError(404, 'not_found')

/**
 * Reads the body up to max bytes. The declared content-length is checked first, then the bytes
 * actually received, so a missing or false header cannot bypass the cap.
 */
async function readBounded(req: Request, max: number): Promise<Uint8Array> {
  const declared = req.headers.get('content-length')
  if (declared !== null && Number(declared) > max) throw new ApiError(413, 'too_large')
  if (!req.body) return new Uint8Array(0)
  const reader = req.body.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      throw new ApiError(413, 'too_large')
    }
    parts.push(value)
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

/** Decodes strict UTF-8 and parses JSON. Any failure is a 400 bad_request. */
function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new ApiError(400, 'bad_request')
  }
}

function validateReportRequest(input: unknown, participants: string[]) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new ApiError(400, 'bad_request')
  const body = input as Record<string, unknown>
  if (body.kind === 'followup') throw new ApiError(400, 'unsupported_kind')
  if (body.kind !== 'group' && body.kind !== 'member') throw new ApiError(400, 'bad_request')
  const kind: 'group' | 'member' = body.kind
  if (typeof body.persona !== 'string' || !PERSONAS.has(body.persona)) throw new ApiError(400, 'bad_request')
  const language = typeof body.language === 'string' ? body.language.trim() : ''
  if (!LANGUAGE.test(language)) throw new ApiError(400, 'bad_request')
  const known = new Set(participants)
  if (typeof body.me !== 'string' || !known.has(body.me)) throw new ApiError(400, 'bad_request')
  let subject: string | null = null
  if (kind === 'member') {
    if (typeof body.subject !== 'string' || !known.has(body.subject)) throw new ApiError(400, 'bad_request')
    subject = body.subject
  }
  return { persona: body.persona as 'brandon' | 'clara' | 'diego', language, me: body.me, kind, subject }
}

const reportView = (r: ReportRow) => ({
  status: r.status,
  progress: r.progress,
  total: r.total,
  persona: r.persona,
  language: r.language,
  kind: r.kind,
  subject: r.subject,
  error: r.error,
  ...(r.status === 'done' ? { content: r.content } : {}),
})

export function createApp(deps: AppDeps = {}) {
  const now = deps.now ?? Date.now
  const app = new Hono<{ Bindings: Env }>()

  // Every /api response: no caching, no sniffing, no referrer leak. Set before the handler runs.
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Referrer-Policy', 'no-referrer')
    await next()
  })

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: err.code }, err.status)
    return c.json({ error: 'internal' }, 500)
  })
  app.notFound((c) => c.json({ error: 'not_found' }, 404))

  /** Counts one hit for this client IP in bucket. Refused hits get 429 with Retry-After. */
  async function limit(c: Context<{ Bindings: Env }>, bucket: string, perHour: number) {
    const ip = c.req.header('CF-Connecting-IP') ?? 'unknown'
    const ok = await checkRateLimit(c.env.DB, await hashIp(ipBucketKey(ip)), bucket, now(), { perHour })
    if (!ok) {
      c.header('Retry-After', String(retryAfterSeconds(now())))
      throw new ApiError(429, 'rate_limited')
    }
  }

  app.get('/api/health', (c) => c.json({ ok: true }))

  app.post('/api/chats', async (c) => {
    await limit(c, 'chat', LIMITS.createChat)
    const up = validateUpload(parseJson(await readBounded(c.req.raw, MAX_UPLOAD_BYTES)))
    const chatId = await createDb(c.env.DB, now).insertChat({
      name: up.name,
      participants: up.participants,
      stats: up.stats,
      chunks: up.chunks,
      expiresAt: now() + CHAT_TTL_MS,
    })
    return c.json(
      {
        chatId,
        name: up.name,
        participants: up.participants,
        stats: { total: up.stats.total, days: up.stats.days, firstTs: up.stats.firstTs, lastTs: up.stats.lastTs },
      },
      201,
    )
  })

  app.post('/api/chats/:id/reports', async (c) => {
    const chatId = c.req.param('id')
    if (!isId(chatId)) throw notFound()
    await limit(c, 'report', LIMITS.createReport)
    const db = createDb(c.env.DB, now)
    const chat = await db.getChat(chatId)
    if (!chat) throw notFound()
    const req = validateReportRequest(parseJson(await readBounded(c.req.raw, SMALL_JSON_BYTES)), chat.participants)
    const chunks = await db.getChunks(chatId)
    const reportId = await db.createReport({ chatId, ...req, subject: req.subject ?? undefined, total: chunks.length + 1 })
    return c.json({ reportId }, 201)
  })

  app.post('/api/reports/:id/advance', async (c) => {
    const id = c.req.param('id')
    if (!isId(id)) throw notFound()
    await limit(c, 'advance', LIMITS.advance)
    let state
    try {
      state = await advanceReport(c.env, id, { provider: deps.provider, now })
    } catch (err) {
      if (err instanceof Error && err.message === 'no_llm_key_configured') throw new ApiError(503, 'llm_not_configured')
      throw err
    }
    if (!state) throw notFound()
    return c.json(state)
  })

  app.get('/api/reports/:id', async (c) => {
    const id = c.req.param('id')
    if (!isId(id)) throw notFound()
    const report = await createDb(c.env.DB, now).getReport(id)
    if (!report) throw notFound()
    return c.json(reportView(report))
  })

  app.delete('/api/reports/:id', async (c) => {
    const id = c.req.param('id')
    if (!isId(id)) throw notFound()
    const db = createDb(c.env.DB, now)
    if (!(await db.getReport(id))) throw notFound()
    await db.deleteReport(id)
    return c.json({ ok: true })
  })

  app.delete('/api/chats/:id', async (c) => {
    const id = c.req.param('id')
    if (!isId(id)) throw notFound()
    const db = createDb(c.env.DB, now)
    if (!(await db.getChat(id))) throw notFound()
    await db.deleteChat(id)
    return c.json({ ok: true })
  })

  app.post('/api/reports/:id/share', async (c) => {
    const id = c.req.param('id')
    if (!isId(id)) throw notFound()
    const db = createDb(c.env.DB, now)
    const report = await db.getReport(id)
    if (!report) throw notFound()
    if (report.shareId) return c.json({ shareId: report.shareId })
    const shareId = randomId()
    await db.setShare(id, shareId)
    return c.json({ shareId })
  })

  app.delete('/api/reports/:id/share', async (c) => {
    const id = c.req.param('id')
    if (!isId(id)) throw notFound()
    const db = createDb(c.env.DB, now)
    if (!(await db.getReport(id))) throw notFound()
    await db.setShare(id, null)
    return c.json({ ok: true })
  })

  app.get('/api/shared/:shareId', async (c) => {
    const shareId = c.req.param('shareId')
    if (!isId(shareId)) throw notFound()
    const db = createDb(c.env.DB, now)
    const report = await db.getReportByShare(shareId)
    if (!report || report.status !== 'done') throw notFound()
    const chat = await db.getChat(report.chatId)
    if (!chat) throw notFound()
    return c.json({ groupName: chat.name, persona: report.persona, language: report.language, content: report.content })
  })

  return app
}

/**
 * Cron: removes expired chats, then old rate rows. Each step has its own try, so one failing does not
 * skip the other, and nothing is thrown out of the handler. The next run retries.
 */
export async function scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
  const at = Date.now()
  try {
    await createDb(env.DB, () => at).deleteExpired(at)
  } catch {
    console.warn('scheduled_expired_cleanup_failed')
  }
  try {
    await deleteOldRateRows(env.DB, at)
  } catch {
    console.warn('scheduled_rate_cleanup_failed')
  }
}

const app = createApp()

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx)
  },
  scheduled,
}
