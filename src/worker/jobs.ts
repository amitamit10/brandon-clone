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
import type { ChunkSummary, GroupReport, ParsedChat } from '../shared/types'
import { createDb, type ReportRow, type ReportStatus } from './db'
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

/**
 * Advances a report by at most ONE LLM call. If some chunk has no stored summary, that chunk is
 * summarised. Otherwise the report is written from all summaries, checked with verifyQuotes, and
 * saved as done. Summaries belong to the chat, so later reports on it reuse them.
 *
 * LLM errors do not fail the job at once: the code (rate_limited or llm_error) goes into `error`,
 * `failures` goes up, and status stays running. After MAX_FAILURES in a row the status is failed.
 * Done and failed reports return at once with no LLM call. Returns null when the report or its chat
 * is missing or expired. Throws no_llm_key_configured when no provider can be built.
 */
export async function advanceReport(env: Env, reportId: string, deps: AdvanceDeps = {}): Promise<JobState | null> {
  const now = deps.now ?? Date.now
  const db = createDb(env.DB, now)

  const report = await db.getReport(reportId)
  if (!report) return null
  if (report.status === 'done' || report.status === 'failed') {
    return { status: report.status, phase: phaseOf(report.status, false), progress: report.progress, total: report.total, error: report.error ?? undefined }
  }

  const chat = await db.getChat(report.chatId)
  if (!chat) return null
  const rows = await db.getChunks(report.chatId)
  const total = rows.length + 1
  const pending = rows.find((r) => r.summary === null)
  const summarized = rows.filter((r) => r.summary !== null).length

  // Throws no_llm_key_configured (mapped to 503 by the route). Not counted as a failure.
  const provider = deps.provider ?? createProviderFromEnv(env)

  if (pending) {
    let summary: ChunkSummary
    try {
      summary = await summarizeChunk(provider, { index: pending.idx, fromId: 0, toId: 0, text: pending.text }, report.language)
    } catch (err) {
      return recordFailure(db, report, err, { progress: summarized, pending: true })
    }
    await db.saveSummary(report.chatId, pending.idx, summary)
    const progress = summarized + 1
    await db.updateReport(reportId, { status: 'running', progress, total, error: null, failures: 0 })
    return { status: 'running', phase: phaseOf('running', progress < total - 1), progress, total }
  }

  // All chunks are summarised: write the report.
  await db.updateReport(reportId, { status: 'running', progress: summarized, total })
  const summaries = rows.map((r) => r.summary as ChunkSummary)
  let generated: GroupReport
  try {
    generated = await generateReport(provider, {
      persona: report.persona,
      language: report.language,
      me: report.me,
      stats: chat.stats,
      summaries,
      kind: report.kind === 'member' ? 'member' : 'group',
      subject: report.subject ?? undefined,
    })
  } catch (err) {
    return recordFailure(db, report, err, { progress: summarized, pending: false })
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
  await db.updateReport(reportId, { status: 'done', progress: total, total, content, error: null, failures: 0 })
  return { status: 'done', phase: 'done', progress: total, total }
}

/** Records one failed LLM step. Only the short code is stored, never the provider's message. */
async function recordFailure(
  db: ReturnType<typeof createDb>,
  report: ReportRow,
  err: unknown,
  at: { progress: number; pending: boolean },
): Promise<JobState> {
  const code = err instanceof RateLimitError ? 'rate_limited' : 'llm_error'
  const failures = report.failures + 1
  const status: ReportStatus = failures >= MAX_FAILURES ? 'failed' : 'running'
  await db.updateReport(report.id, { status, failures, error: code, progress: at.progress })
  return { status, phase: phaseOf(status, at.pending), progress: at.progress, total: report.total, error: code }
}
