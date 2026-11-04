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
import { searchChunks } from '../pipeline/search'
import type { ChunkSummary, GroupReport, ParsedChat } from '../shared/types'
import { createDb, type ReportStatus } from './db'
import type { Env } from './index'

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
}

const phaseOf = (status: ReportStatus, pendingSummaries: boolean): JobPhase => {
  if (status === 'done') return 'done'
  if (status === 'failed') return 'failed'
  return pendingSummaries ? 'summarizing' : 'reporting'
}

/** How long one advance may hold a report. A crashed holder is retried after this. */
export const LEASE_MS = 120_000

/** Chunks retrieved for a follow-up question. */
export const RETRIEVE_K = 3
/** Total characters of retrieved lines sent with a follow-up. */
export const RETRIEVED_MAX_CHARS = 8_000
const DAY_HEADER = /^--- \d{4}-\d{2}-\d{2} ---$/

/**
 * The lines of the retrieved chunks, in chunk order (idx), without the '--- date ---' headers and
 * without blank lines. Stops before the total would pass RETRIEVED_MAX_CHARS, so the lines kept are
 * always the earliest ones in chunk order.
 */
export function retrievedLines(hits: { idx: number; text: string }[]): string[] {
  const out: string[] = []
  let size = 0
  for (const hit of [...hits].sort((a, b) => a.idx - b.idx)) {
    for (const raw of hit.text.split('\n')) {
      const line = raw.replace(/\r$/, '')
      if (line.trim() === '' || DAY_HEADER.test(line)) continue
      if (size + line.length + 1 > RETRIEVED_MAX_CHARS) return out
      out.push(line)
      size += line.length + 1
    }
  }
  return out
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
  const pending = rows.find((r) => r.summary === null)
  const summarized = rows.filter((r) => r.summary !== null).length

  // Throws no_llm_key_configured (mapped to 503 by the route). Not counted as a failure.
  const provider = deps.provider ?? createProviderFromEnv(env)

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
    return { status: 'failed', phase: 'failed', progress: summarized, total, error: 'llm_error' }
  }

  if (pending) {
    let summary: ChunkSummary
    try {
      summary = await summarizeChunk(provider, { index: pending.idx, fromId: 0, toId: 0, text: pending.text }, report.language)
    } catch (err) {
      return recordFailure(db, reportId, err, { progress: summarized, total, pending: true })
    }
    await db.saveSummary(report.chatId, pending.idx, summary)
    const progress = summarized + 1
    await db.advanceProgress(reportId, { progress, total })
    return { status: 'running', phase: phaseOf('running', progress < total - 1), progress, total }
  }

  // All chunks are summarised: write the report. A follow-up first retrieves the chunks that match its question.
  const summaries = rows.map((r) => r.summary as ChunkSummary)
  const followup = report.kind === 'followup'
  const question = followup ? (report.question ?? '') : undefined
  const retrieved = followup ? retrievedLines(searchChunks(rows.map((r) => ({ idx: r.idx, text: r.text })), question ?? '', RETRIEVE_K)) : undefined
  let generated: GroupReport
  try {
    generated = await generateReport(provider, {
      persona: report.persona,
      language: report.language,
      me: report.me,
      stats: chat.stats,
      summaries,
      kind: followup ? 'followup' : report.kind === 'member' ? 'member' : 'group',
      subject: report.subject ?? undefined,
      question,
      retrieved,
    })
  } catch (err) {
    return recordFailure(db, reportId, err, { progress: summarized, total, pending: false })
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
  const written = await db.finishReport(reportId, content, total)
  if (!written) {
    const current = await db.getReport(reportId)
    return current ? stateOf(current) : null
  }
  return { status: 'done', phase: 'done', progress: total, total }
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
): Promise<JobState> {
  const code = err instanceof RateLimitError ? 'rate_limited' : 'llm_error'
  const after = await db.failAttempt(reportId, code, MAX_FAILURES)
  const status: ReportStatus = after?.status ?? 'running'
  return { status, phase: phaseOf(status, at.pending), progress: at.progress, total: at.total, error: code }
}
