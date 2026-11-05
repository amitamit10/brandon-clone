// Cloudflare FREE-plan limits that drive the step-per-LLM-call job design
// (read from developers.cloudflare.com on 2026-11-05):
//   Workers: 50 subrequests/invocation, 10 ms CPU/request (time awaiting fetch/D1 is NOT CPU),
//            cron triggers allowed (5/account), 100k requests/day.
//   D1:      100k rows written/day, 5M rows read/day, 500 MB/db, 2 MB max row/value,
//            100 bound params/query, 50 queries/invocation, 100 KB max SQL statement.
// Consequences: each `advance` call does ONE LLM call; chats are stored as ~24 KB chunk
// rows (never one row per message); batch inserts must stay under 100 bound params/query.
// Risk: parsing+stats of a ~1 MB chat may exceed 10 ms CPU. Measure in Task 12; fallback is
// to parse in the browser (parser is pure TS) or use Workers Paid.
// Resolved: the browser parses, computes stats and chunks; the Worker only stores and advances.
import { RateLimitError, type LlmProvider } from '../llm/provider'
import { createProviderFromEnv } from '../llm/index'
import { generateReport, verifyQuotes } from '../pipeline/report'
import { reconstructMessages } from '../pipeline/reconstruct'
import { summarizeChunk } from '../pipeline/summarize'
import { searchChunks, tokenize } from '../pipeline/search'
import type { ChunkSummary, GroupReport, ParsedChat } from '../shared/types'
import { createDb, type ReportStatus } from './db'
import type { Env } from './index'
import { instrument, type LlmCallInfo } from '../llm/index'
import type { UsageBuffer } from './usage'

/** Consecutive failed LLM steps before a report is marked failed. */
export const MAX_FAILURES = 5

export type JobPhase = 'summarizing' | 'reporting' | 'done' | 'failed'

export interface JobState {
  status: ReportStatus
  phase: JobPhase
  progress: number
  total: number
  error?: string
}

export interface AdvanceDeps {
  provider?: LlmProvider
  now?: () => number
  /** Collects usage counters for this request. Flushed by the route. */
  usage?: UsageBuffer
}

const phaseOf = (status: ReportStatus, pendingSummaries: boolean): JobPhase => {
  if (status === 'done') return 'done'
  if (status === 'failed') return 'failed'
  return pendingSummaries ? 'summarizing' : 'reporting'
}

/** How long one advance may hold a report. A crashed holder is retried after this. */
export const LEASE_MS = 240_000

/** The whole advance (every retry of every model) must end before the lease can expire. */
export const ADVANCE_DEADLINE_MS = 200_000

/** Chunks retrieved for a follow-up question. */
export const RETRIEVE_K = 3
/** Total characters of retrieved lines sent with a follow-up. */
export const RETRIEVED_MAX_CHARS = 8_000
const DAY_HEADER = /^--- \d{4}-\d{2}-\d{2} ---$/

/** One line longer than this is cut, so a single huge message cannot take the whole budget. */
const RETRIEVED_LINE_MAX = 2_000

/**
 * Picks the lines of the retrieved chunks for a follow-up, within RETRIEVED_MAX_CHARS. `hits` must be in
 * rank order (best first), as searchChunks returns them. Lines that share a term with the question are
 * taken first, so a match late in a chunk is not lost; the rest of the budget is filled in rank order.
 * Day headers and blank lines are dropped. The result is in chunk order (idx, then line position).
 */
export function retrievedLines(hits: { idx: number; text: string }[], question: string): string[] {
  const terms = new Set(tokenize(question))
  const candidates: { idx: number; pos: number; line: string; matches: boolean }[] = []
  for (const hit of hits) {
    hit.text.split('\n').forEach((raw, pos) => {
      const trimmed = raw.replace(/\r$/, '')
      if (trimmed.trim() === '' || DAY_HEADER.test(trimmed)) return
      const line = trimmed.length > RETRIEVED_LINE_MAX ? trimmed.slice(0, RETRIEVED_LINE_MAX) : trimmed
      candidates.push({ idx: hit.idx, pos, line, matches: tokenize(trimmed).some((t) => terms.has(t)) })
    })
  }
  const ordered = [...candidates.filter((c) => c.matches), ...candidates.filter((c) => !c.matches)]
  const chosen: typeof candidates = []
  let size = 0
  for (const c of ordered) {
    if (size + c.line.length + 1 > RETRIEVED_MAX_CHARS) continue
    chosen.push(c)
    size += c.line.length + 1
  }
  chosen.sort((x, y) => x.idx - y.idx || x.pos - y.pos)
  return chosen.map((c) => c.line)
}

/**
 * Advances a report by at most ONE LLM call. If some chunk has no stored summary, that chunk is
 * summarised. Otherwise the report is written from all summaries, checked with verifyQuotes, and
 * saved as done. Summaries belong to the chat, so later reports on it reuse them.
 *
 * Before the model is called the attempt is CLAIMED atomically (failures + 1 and a lease), so a crash
 * or CPU kill still counts, and two overlapping calls cannot both run: the second one gets the
 * current state back with no LLM call. LLM errors do not fail the job at once: the code
 * (rate_limited or llm_error) goes into `error` and the report stays running; after MAX_FAILURES
 * attempts in a row without a success it is failed. All writes after the call are conditional on the
 * report still being open, so a late call can never revive or overwrite a failed or done report.
 * Returns null when the report or its chat is missing or expired. Throws no_llm_key_configured when
 * no provider can be built.
 */
export async function advanceReport(env: Env, reportId: string, deps: AdvanceDeps = {}): Promise<JobState | null> {
  const now = deps.now ?? Date.now
  const db = createDb(env.DB, now)

  const report = await db.getReport(reportId)
  if (!report) return null
  if (report.status === 'done' || report.status === 'failed') return stateOf(report)

  const chat = await db.getChat(report.chatId)
  if (!chat) return null
  const rows = await db.getChunks(report.chatId)
  const total = rows.length + 1
  const totalChars = rows.reduce((n, r) => n + r.text.length, 0)
  const direct = env.LLM_DIRECT === '1' && totalChars <= directMaxChars(env)
  const concurrency = Math.min(Number(env.CHUNK_CONCURRENCY) || 1, 6)
  const unsummarized = direct ? [] : rows.filter((r) => r.summary === null)
  const pendingBatch = unsummarized.slice(0, Math.max(1, concurrency))
  const pending = pendingBatch[0]
  const summarized = direct ? 0 : rows.filter((r) => r.summary !== null).length

  // Throws no_llm_key_configured (mapped to 503 by the route). Not counted as a failure.
  const onCall = (info: LlmCallInfo) => deps.usage?.llmCall(info)
  const base = deps.provider
    ? instrument(deps.provider, { onCall })
    : createProviderFromEnv(env, { purpose: pending ? 'summary' : 'report', hooks: { onCall } })
  const deadline = AbortSignal.timeout(ADVANCE_DEADLINE_MS)
  const provider: LlmProvider = {
    name: base.name,
    model: base.model,
    generate: (req) => base.generate({ ...req, signal: req.signal ?? deadline }),
  }

  const claim = await db.claimAttempt(reportId, MAX_FAILURES, LEASE_MS)
  if (claim === null) return null
  if (claim.outcome !== 'claimed') {
    // done/failed meanwhile, or another advance holds the lease: report the current state, no LLM call
    const current = await db.getReport(reportId)
    return current ? stateOf(current, pending !== undefined) : null
  }
  if (claim.failures > MAX_FAILURES) {
    // attempts were counted but never completed (crashes): stop retrying
    await db.failReport(reportId, 'llm_error')
    deps.usage?.add('report_failed', 'all')
    return { status: 'failed', phase: 'failed', progress: summarized, total, error: 'llm_error' }
  }

  if (pendingBatch.length > 0) {
    try {
      await Promise.all(
        pendingBatch.map(async (c) => {
          const summary = await summarizeChunk(provider, { index: c.idx, fromId: 0, toId: 0, text: c.text }, report.language)
          await db.saveSummary(report.chatId, c.idx, summary)
        }),
      )
    } catch (err) {
      return recordFailure(db, reportId, err, { progress: summarized, total, pending: true }, claim.token, deps.usage)
    }
    const progress = summarized + pendingBatch.length
    if (!(await db.advanceProgress(reportId, { progress, total }, claim.token))) {
      const current = await db.getReport(reportId)
      return current ? stateOf(current, true) : null
    }
    return { status: 'running', phase: phaseOf('running', progress < total - 1), progress, total }
  }

  // All chunks are summarised: write the report. A follow-up first retrieves the chunks that match its question.
  const summaries = direct ? [] : rows.map((r) => r.summary as ChunkSummary)
  const followup = report.kind === 'followup'
  const transcript = direct && !followup ? rows.map((r) => r.text).join('\n') : undefined
  const question = followup ? (report.question ?? '') : undefined
  const retrieved = followup ? retrievedLines(searchChunks(rows.map((r) => ({ idx: r.idx, text: r.text })), question ?? '', RETRIEVE_K), question ?? '') : undefined
  let generated: GroupReport
  try {
    generated = await generateReport(provider, {
      persona: report.persona,
      language: report.language,
      me: report.me,
      stats: chat.stats,
      summaries,
      transcript,
      kind: followup ? 'followup' : report.kind === 'member' ? 'member' : 'group',
      subject: report.subject ?? undefined,
      question,
      retrieved,
    })
  } catch (err) {
    return recordFailure(db, reportId, err, { progress: summarized, total, pending: false }, claim.token, deps.usage)
  }

  const parsed: ParsedChat = {
    messages: reconstructMessages(
      rows.map((r) => ({ index: r.idx, text: r.text })),
      chat.participants,
    ),
    participants: chat.participants,
    systemEvents: [],
    format: 'android',
    dateOrder: 'mdy',
  }
  const content = verifyQuotes(generated, parsed)
  const written = await db.finishReport(reportId, content, total, claim.token)
  if (!written) {
    const current = await db.getReport(reportId)
    return current ? stateOf(current) : null
  }
  deps.usage?.add('report_done', 'all')
  deps.usage?.add('report_seconds', 'sum', Math.max(0, Math.round((now() - report.createdAt) / 1000)))
  return { status: 'done', phase: 'done', progress: total, total }
}

function directMaxChars(env: Env): number {
  const n = Number(env.LLM_DIRECT_MAX_CHARS)
  return Number.isFinite(n) && n > 0 ? Math.min(n, 2_500_000) : 1_200_000
}

function stateOf(r: { status: ReportStatus; progress: number; total: number; error: string | null }, pendingSummaries = false): JobState {
  return { status: r.status, phase: phaseOf(r.status, pendingSummaries), progress: r.progress, total: r.total, error: r.error ?? undefined }
}

/** Records one failed LLM step. Only the short code is stored, never the provider's message. */
async function recordFailure(
  db: ReturnType<typeof createDb>,
  reportId: string,
  err: unknown,
  at: { progress: number; total: number; pending: boolean },
  token: number,
  usage?: UsageBuffer,
): Promise<JobState> {
  const code = err instanceof RateLimitError ? 'rate_limited' : 'llm_error'
  const after = await db.failAttempt(reportId, code, MAX_FAILURES, token)
  const status: ReportStatus = after?.status ?? 'running'
  if (status === 'failed') usage?.add('report_failed', 'all')
  return { status, phase: phaseOf(status, at.pending), progress: at.progress, total: at.total, error: code }
}
