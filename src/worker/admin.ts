/**
 * Owner-only admin API under /api/admin. Everything here sits behind ADMIN_TOKEN: when that is missing or
 * shorter than 24 characters every admin route answers 404. Admin responses may include chat, group, member
 * and uploader names and stored text, so each one is no-store and every content view is counted.
 */
import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Env } from './index'
import { createDb } from './db'
import { checkRateLimit, hashIp, ipBucketKey, retryAfterSeconds } from './ratelimit'
import { bump, dayOf, quietly } from './usage'
import { readBounded } from './body'
import { ApiError } from './validate'

const SESSION = 'admin_session'
const SESSION_MS = 12 * 60 * 60 * 1000
const DAY_MS = 86_400_000
const MIN_TOKEN = 24
const LOGIN_PER_HOUR = 5
const LOGIN_BODY_MAX = 1024
const COOKIE_RE = /^v1\.(\d{1,16})\.([A-Za-z0-9_-]{43})$/
const ID_RE = /^[0-9a-f]{8}([0-9a-f]{24})?$/
/** Error codes that may be shown; anything else is reported as 'other'. */
const ERROR_CODE_RE = /^[a-z_]{1,32}$/
const enc = new TextEncoder()

export interface AdminDeps {
  /** Clock in ms (tests). */
  now?: () => number
}

const enabled = (env: Env) => typeof env.ADMIN_TOKEN === 'string' && env.ADMIN_TOKEN.length >= MIN_TOKEN

/** Parses an integer query value, clamped to [min, max]. Missing or invalid gives the default. */
function intParam(raw: string | undefined, def: number, min: number, max: number): number {
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

/** Escapes LIKE wildcards so the search text is matched literally (used with ESCAPE '\'). */
export function likeContains(text: string): string {
  return `%${text.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
}

const sha256 = async (text: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)))

/** Compares two equal-length byte arrays without an early exit. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

/** Token check: both sides are hashed first, so the comparison is always over 32 bytes. */
async function tokenMatches(given: string, expected: string): Promise<boolean> {
  return sameBytes(await sha256(given), await sha256(expected))
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function hmacKey(token: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, [usage])
}

/** Session cookie value: v1.<expiryMs>.<HMAC-SHA256(token, 'v1.<expiryMs>') base64url>. */
async function signSession(token: string, expiry: number): Promise<string> {
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(token, 'sign'), enc.encode(`v1.${expiry}`))
  return `v1.${expiry}.${b64url(new Uint8Array(mac))}`
}

async function sessionValid(token: string, value: string | undefined, now: number): Promise<boolean> {
  if (!value) return false
  const m = COOKIE_RE.exec(value)
  if (!m) return false
  const expiry = Number(m[1])
  if (!Number.isSafeInteger(expiry) || expiry <= now) return false
  try {
    const sig = Uint8Array.from(atob(m[2].replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0))
    return await crypto.subtle.verify('HMAC', await hmacKey(token, 'verify'), sig, enc.encode(`v1.${expiry}`))
  } catch {
    return false
  }
}

/** Reads {"token": "..."} from the first LOGIN_BODY_MAX bytes. Anything else, or too large a body, gives null. */
function parseToken(raw: Uint8Array): string | null {
  try {
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) as { token?: unknown }
    return typeof body.token === 'string' && body.token.length <= 200 ? body.token : null
  } catch {
    return null
  }
}

/** Resolves a full 32-hex id or an 8-hex prefix. Table names are fixed literals, never user input. */
async function resolveId(d1: D1Database, table: 'chats' | 'reports', raw: string): Promise<{ id: string } | { error: 'not_found' | 'ambiguous' }> {
  if (!ID_RE.test(raw)) return { error: 'not_found' }
  const where = raw.length === 32 ? 'id = ?' : 'substr(id, 1, 8) = ?'
  const rows = await d1.prepare(`SELECT id FROM ${table} WHERE ${where} LIMIT 2`).bind(raw).all<{ id: string }>()
  if (rows.results.length === 0) return { error: 'not_found' }
  if (rows.results.length > 1) return { error: 'ambiguous' }
  return { id: rows.results[0].id }
}

const CHAT_SUMMARY =
  'SELECT c.id, c.name, c.uploader_name, c.participants_json, c.created_at, c.expires_at, ' +
  "json_extract(c.stats_json, '$.total') AS messages, " +
  '(SELECT COUNT(*) FROM chat_chunks k WHERE k.chat_id = c.id) AS chunks, ' +
  '(SELECT COUNT(*) FROM reports r WHERE r.chat_id = c.id) AS reports, ' +
  "(SELECT COUNT(*) FROM reports r WHERE r.chat_id = c.id AND r.status = 'done') AS reportsDone, " +
  '(SELECT COUNT(*) FROM reports r WHERE r.chat_id = c.id AND r.share_id IS NOT NULL) AS shared'

interface SummaryRow {
  id: string
  name: string
  uploader_name: string | null
  participants_json: string
  created_at: number
  expires_at: number
  messages: number | null
  chunks: number
  reports: number
  reportsDone: number
  shared: number
}

function summaryView(r: SummaryRow, at: number) {
  const participantNames = JSON.parse(r.participants_json) as string[]
  return {
    id: r.id,
    id8: r.id.slice(0, 8),
    groupName: r.name,
    uploaderName: r.uploader_name ?? 'unknown',
    participantNames,
    participants: participantNames.length,
    messages: r.messages ?? 0,
    chunks: r.chunks,
    reports: r.reports,
    reportsDone: r.reportsDone,
    hasShared: r.shared > 0,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    expired: r.expires_at <= at,
  }
}

/** Which reports-by-X buckets we report. Other stored values are ignored. */
const STATUSES = ['queued', 'running', 'done', 'failed'] as const
const KINDS = ['group', 'member', 'followup'] as const
const PERSONAS = ['brandon', 'clara', 'diego'] as const

function tally<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>
}

export function createAdminApp(deps: AdminDeps = {}) {
  const now = deps.now ?? Date.now
  const app = new Hono<{ Bindings: Env }>()

  // Disabled unless a usable token is configured. Checked before anything else, including the body.
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    c.header('X-Content-Type-Options', 'nosniff')
    if (!enabled(c.env)) return c.json({ error: 'not_found' }, 404)
    await next()
  })

  // Mutations (POST, DELETE) need the custom header that a cross-site form cannot send, and a matching Origin when one is sent.
  app.use('*', async (c, next) => {
    if (c.req.method !== 'POST' && c.req.method !== 'DELETE') return next()
    if (c.req.header('X-Admin') !== '1') return c.json({ error: 'forbidden' }, 403)
    const origin = c.req.header('Origin')
    if (origin !== undefined && origin !== new URL(c.req.url).origin) return c.json({ error: 'forbidden' }, 403)
    await next()
  })

  const requireSession = async (c: Context<{ Bindings: Env }>, next: () => Promise<void>) => {
    if (!(await sessionValid(c.env.ADMIN_TOKEN as string, getCookie(c, SESSION), now()))) return c.json({ error: 'unauthorized' }, 401)
    await next()
  }

  app.notFound((c) => c.json({ error: 'not_found' }, 404))

  app.post('/login', async (c) => {
    const ip = c.req.header('CF-Connecting-IP') ?? 'unknown'
    const ok = await checkRateLimit(c.env.DB, await hashIp(ipBucketKey(ip)), 'admin-login', now(), { perHour: LOGIN_PER_HOUR })
    if (!ok) {
      await quietly(() => bump(c.env.DB, dayOf(now()), 'rate_limited', 'admin-login'))
      c.header('Retry-After', String(retryAfterSeconds(now())))
      return c.json({ error: 'rate_limited' }, 429)
    }
    // The body is read with a hard cap before anything is compared. Over the cap nothing is checked.
    let raw: Uint8Array
    try {
      raw = await readBounded(c.req.raw, LOGIN_BODY_MAX)
    } catch (err) {
      if (err instanceof ApiError && err.status === 413) return c.json({ error: 'too_large' }, 413)
      throw err
    }
    const token = parseToken(raw)
    const matches = token !== null && (await tokenMatches(token, c.env.ADMIN_TOKEN as string))
    if (!matches) {
      await quietly(() => bump(c.env.DB, dayOf(now()), 'admin_login_failed', 'all'))
      return c.json({ error: 'unauthorized' }, 401)
    }
    const expiry = now() + SESSION_MS
    setCookie(c, SESSION, await signSession(c.env.ADMIN_TOKEN as string, expiry), {
      httpOnly: true,
      sameSite: 'Strict',
      path: '/api/admin',
      maxAge: SESSION_MS / 1000,
      secure: new URL(c.req.url).protocol === 'https:',
    })
    return c.json({ ok: true })
  })

  app.post('/logout', (c) => {
    deleteCookie(c, SESSION, { path: '/api/admin', secure: new URL(c.req.url).protocol === 'https:' })
    return c.json({ ok: true })
  })

  app.get('/overview', requireSession, async (c) => {
    const days = intParam(c.req.query('days'), 30, 1, 90)
    const t = now()
    const dayList = Array.from({ length: days }, (_, i) => dayOf(t - (days - 1 - i) * DAY_MS))
    const start = dayList[0]
    const d1 = c.env.DB

    const chats = await d1
      .prepare(
        'SELECT COUNT(*) AS chatsAll, COALESCE(SUM(CASE WHEN expires_at > ? THEN 1 ELSE 0 END), 0) AS chatsActive, ' +
          '(SELECT COALESCE(SUM(LENGTH(CAST(text AS BLOB))), 0) FROM chat_chunks) AS chunkBytes FROM chats',
      )
      .bind(t)
      .first<{ chatsAll: number; chatsActive: number; chunkBytes: number }>()
    const reports = await d1
      .prepare(
        'SELECT status, kind, persona, COUNT(*) AS n, COALESCE(SUM(CASE WHEN share_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS shared ' +
          'FROM reports GROUP BY status, kind, persona',
      )
      .all<{ status: string; kind: string; persona: string; n: number; shared: number }>()
    const usage = await d1
      .prepare('SELECT day, metric, key, count FROM usage_daily WHERE day >= ?')
      .bind(start)
      .all<{ day: string; metric: string; key: string; count: number }>()
    const visitors = await d1.prepare('SELECT day, COUNT(*) AS n FROM visitors WHERE day >= ? GROUP BY day').bind(start).all<{ day: string; n: number }>()

    const byStatus = tally(STATUSES)
    const byKind = tally(KINDS)
    const byPersona = tally(PERSONAS)
    let reportsAll = 0
    let sharedLinks = 0
    for (const r of reports.results) {
      reportsAll += r.n
      sharedLinks += r.shared
      if (r.status in byStatus) byStatus[r.status as (typeof STATUSES)[number]] += r.n
      if (r.kind in byKind) byKind[r.kind as (typeof KINDS)[number]] += r.n
      if (r.persona in byPersona) byPersona[r.persona as (typeof PERSONAS)[number]] += r.n
    }

    const daily = new Map(
      dayList.map((day) => [
        day,
        { day, uploads: 0, reportsCreated: 0, reportsDone: 0, reportsFailed: 0, llmCalls: 0, llmFails: 0, rateLimited: 0, visitors: 0, uploadKB: 0 },
      ]),
    )
    for (const v of visitors.results) {
      const row = daily.get(v.day)
      if (row) row.visitors = v.n
    }
    const models = new Map<string, { key: string; calls: number; fails: number; rate429: number }>()
    let loginFailed = 0
    let doneSeconds = 0
    let doneCount = 0
    let contentViews = 0
    for (const u of usage.results) {
      const row = daily.get(u.day)
      switch (u.metric) {
        case 'upload':
          if (row) row.uploads += u.count
          break
        case 'upload_bytes':
          if (row) row.uploadKB += u.count
          break
        case 'report_created':
          if (row) row.reportsCreated += u.count
          break
        case 'report_done':
          if (row) row.reportsDone += u.count
          doneCount += u.count
          break
        case 'report_failed':
          if (row) row.reportsFailed += u.count
          break
        case 'rate_limited':
          if (row) row.rateLimited += u.count
          break
        case 'report_seconds':
          doneSeconds += u.count
          break
        case 'admin_login_failed':
          loginFailed += u.count
          break
        case 'admin_content_view':
          contentViews += u.count
          break
        case 'llm_call':
        case 'llm_fail':
        case 'llm_429': {
          if (row) {
            if (u.metric === 'llm_call') row.llmCalls += u.count
            if (u.metric === 'llm_fail') row.llmFails += u.count
          }
          const m = models.get(u.key) ?? { key: u.key, calls: 0, fails: 0, rate429: 0 }
          if (u.metric === 'llm_call') m.calls += u.count
          if (u.metric === 'llm_fail') m.fails += u.count
          if (u.metric === 'llm_429') m.rate429 += u.count
          models.set(u.key, m)
          break
        }
      }
    }

    return c.json({
      totals: {
        chatsActive: chats?.chatsActive ?? 0,
        chatsAll: chats?.chatsAll ?? 0,
        reportsAll,
        reportsByStatus: byStatus,
        reportsByKind: byKind,
        reportsByPersona: byPersona,
        sharedLinks,
        storedChunkKB: Math.round((chats?.chunkBytes ?? 0) / 1024),
        contentViews,
      },
      daily: [...daily.values()],
      llmByModel: [...models.values()].sort((a, b) => b.calls - a.calls),
      avgReportSeconds: doneCount > 0 ? Math.round((doneSeconds / doneCount) * 10) / 10 : null,
      adminLoginFailed: loginFailed,
    })
  })

  app.get('/chats', requireSession, async (c) => {
    const limit = intParam(c.req.query('limit'), 50, 1, 100)
    const offset = intParam(c.req.query('offset'), 0, 0, 1_000_000)
    const q = (c.req.query('q') ?? '').slice(0, 100).trim().toLowerCase()
    const at = now()
    // The search text is bound, with LIKE wildcards escaped. Participant names are matched one by one in JSON.
    const filter = q
      ? "WHERE LOWER(c.name) LIKE ? ESCAPE '\\' OR LOWER(c.uploader_name) LIKE ? ESCAPE '\\' " +
        "OR EXISTS (SELECT 1 FROM json_each(c.participants_json) je WHERE LOWER(je.value) LIKE ? ESCAPE '\\')"
      : ''
    const binds = q ? [likeContains(q), likeContains(q), likeContains(q)] : []
    const d1 = c.env.DB
    const total = await d1
      .prepare(`SELECT COUNT(*) AS n FROM chats c ${filter}`)
      .bind(...binds)
      .first<{ n: number }>()
    const rows = await d1
      .prepare(`${CHAT_SUMMARY} FROM chats c ${filter} ORDER BY c.created_at DESC, c.id LIMIT ? OFFSET ?`)
      .bind(...binds, limit, offset)
      .all<SummaryRow>()
    return c.json({ chats: rows.results.map((r) => summaryView(r, at)), total: total?.n ?? 0 })
  })

  app.get('/uploaders', requireSession, async (c) => {
    const rows = await c.env.DB
      .prepare(
        "SELECT COALESCE(LOWER(TRIM(c.uploader_name)), 'unknown') AS uploaderName, COUNT(*) AS chats, MAX(c.created_at) AS lastSeen, " +
          'COALESCE(SUM((SELECT COUNT(*) FROM reports r WHERE r.chat_id = c.id)), 0) AS reports ' +
          'FROM chats c GROUP BY uploaderName ORDER BY lastSeen DESC LIMIT 200',
      )
      .all<{ uploaderName: string; chats: number; lastSeen: number; reports: number }>()
    return c.json({ uploaders: rows.results })
  })

  app.get('/chats/:id', requireSession, async (c) => {
    const d1 = c.env.DB
    const found = await resolveId(d1, 'chats', (c.req.param('id') ?? ''))
    if ('error' in found) return c.json({ error: found.error }, found.error === 'ambiguous' ? 409 : 404)
    const chat = await d1.prepare(`${CHAT_SUMMARY} FROM chats c WHERE c.id = ?`).bind(found.id).first<SummaryRow>()
    if (!chat) return c.json({ error: 'not_found' }, 404)
    const reports = await d1
      .prepare(
        'SELECT id, kind, persona, language, me, subject, question, status, progress, total, failures, error, content_json, created_at, share_id ' +
          'FROM reports WHERE chat_id = ? ORDER BY created_at',
      )
      .bind(found.id)
      .all<{
        id: string
        kind: string
        persona: string
        language: string
        me: string
        subject: string | null
        question: string | null
        status: string
        progress: number
        total: number
        failures: number
        error: string | null
        content_json: string | null
        created_at: number
        share_id: string | null
      }>()
    await quietly(() => bump(d1, dayOf(now()), 'admin_content_view', 'all'))
    return c.json({
      ...summaryView(chat, now()),
      reports: reports.results.map((r) => ({
        id: r.id,
        id8: r.id.slice(0, 8),
        kind: r.kind,
        persona: r.persona,
        language: r.language,
        me: r.me,
        subject: r.subject,
        question: r.question,
        status: r.status,
        progress: r.progress,
        total: r.total,
        failures: r.failures,
        error: r.error && ERROR_CODE_RE.test(r.error) ? r.error : r.error ? 'other' : null,
        createdAt: r.created_at,
        shared: r.share_id !== null,
        shareId: r.share_id,
        content: r.content_json === null ? null : (JSON.parse(r.content_json) as unknown),
      })),
    })
  })

  app.get('/chats/:id/messages', requireSession, async (c) => {
    const d1 = c.env.DB
    const found = await resolveId(d1, 'chats', (c.req.param('id') ?? ''))
    if ('error' in found) return c.json({ error: found.error }, found.error === 'ambiguous' ? 409 : 404)
    const count = await d1.prepare('SELECT COUNT(*) AS n FROM chat_chunks WHERE chat_id = ?').bind(found.id).first<{ n: number }>()
    const chunks = count?.n ?? 0
    const index = intParam(c.req.query('chunk'), 0, 0, 1_000_000)
    if (chunks === 0 || index >= chunks) return c.json({ error: 'not_found' }, 404)
    const row = await d1.prepare('SELECT text FROM chat_chunks WHERE chat_id = ? AND idx = ?').bind(found.id, index).first<{ text: string }>()
    if (!row) return c.json({ error: 'not_found' }, 404)
    await quietly(() => bump(d1, dayOf(now()), 'admin_content_view', 'all'))
    return c.json({ chunk: index, chunks, text: row.text })
  })

  app.delete('/chats/:id', requireSession, async (c) => {
    const found = await resolveId(c.env.DB, 'chats', (c.req.param('id') ?? ''))
    if ('error' in found) return c.json({ error: found.error }, found.error === 'ambiguous' ? 409 : 404)
    await createDb(c.env.DB, now).deleteChat(found.id)
    return c.json({ ok: true })
  })

  app.delete('/reports/:id', requireSession, async (c) => {
    const found = await resolveId(c.env.DB, 'reports', (c.req.param('id') ?? ''))
    if ('error' in found) return c.json({ error: found.error }, found.error === 'ambiguous' ? 409 : 404)
    await createDb(c.env.DB, now).deleteReport(found.id)
    return c.json({ ok: true })
  })

  app.post('/reports/:id/unshare', requireSession, async (c) => {
    const found = await resolveId(c.env.DB, 'reports', (c.req.param('id') ?? ''))
    if ('error' in found) return c.json({ error: found.error }, found.error === 'ambiguous' ? 409 : 404)
    await createDb(c.env.DB, now).setShare(found.id, null)
    return c.json({ ok: true })
  })

  return app
}
