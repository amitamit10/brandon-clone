import type { ChatStats, Chunk, ChunkSummary, GroupReport, PersonaId } from '../shared/types'

export type ReportStatus = 'queued' | 'running' | 'done' | 'failed'
export type ReportKindDb = 'group' | 'member' | 'followup'

export interface ChatRow {
  id: string
  name: string
  participants: string[]
  stats: ChatStats
  createdAt: number
  expiresAt: number
}

export interface ChunkRow {
  chatId: string
  idx: number
  text: string
  summary: ChunkSummary | null
}

export interface NewReport {
  chatId: string
  persona: PersonaId
  language: string
  me: string
  kind: ReportKindDb
  subject?: string
  question?: string
  total?: number
}

export interface ReportRow {
  id: string
  chatId: string
  persona: PersonaId
  language: string
  me: string
  kind: ReportKindDb
  subject: string | null
  question: string | null
  status: ReportStatus
  progress: number
  total: number
  content: GroupReport | null
  error: string | null
  /** consecutive failed LLM steps; reset on success (migration 0002) */
  failures: number
  shareId: string | null
  createdAt: number
}

/** Statements per D1 batch. Keeps each batch well under D1 limits; a batch is atomic. */
const BATCH = 50
const ROWS_PER_INSERT = 33

function chunkRows<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Random 128-bit id as 32 lowercase hex characters. Used for chat, report and share ids. */
export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

interface ChatDbRow {
  id: string
  name: string
  participants_json: string
  stats_json: string
  created_at: number
  expires_at: number
}
interface ChunkDbRow {
  chat_id: string
  idx: number
  text: string
  summary_json: string | null
}
interface ReportDbRow {
  id: string
  chat_id: string
  persona: PersonaId
  language: string
  me: string
  kind: ReportKindDb
  subject: string | null
  question: string | null
  status: ReportStatus
  progress: number
  total: number
  content_json: string | null
  error: string | null
  failures: number
  share_id: string | null
  created_at: number
}

const parse = <T>(s: string | null): T | null => (s === null ? null : (JSON.parse(s) as T))

/**
 * Copies a sender-keyed record into a prototype-free one. JSON.parse gives plain objects,
 * so a sender named "constructor" would otherwise read Object.prototype members.
 */
function nullProto<T>(src: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = Object.create(null)
  for (const [key, value] of Object.entries(src)) out[key] = value
  return out
}

const toChat = (r: ChatDbRow): ChatRow => {
  const stats = JSON.parse(r.stats_json) as ChatStats
  stats.perMember = nullProto(stats.perMember)
  return {
    id: r.id,
    name: r.name,
    participants: JSON.parse(r.participants_json) as string[],
    stats,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  }
}
const toChunk = (r: ChunkDbRow): ChunkRow => {
  const summary = parse<ChunkSummary>(r.summary_json)
  if (summary) summary.memberNotes = nullProto(summary.memberNotes)
  return { chatId: r.chat_id, idx: r.idx, text: r.text, summary }
}
const toReport = (r: ReportDbRow): ReportRow => ({
  id: r.id,
  chatId: r.chat_id,
  persona: r.persona,
  language: r.language,
  me: r.me,
  kind: r.kind,
  subject: r.subject,
  question: r.question,
  status: r.status,
  progress: r.progress,
  total: r.total,
  content: parse<GroupReport>(r.content_json),
  error: r.error,
  failures: r.failures,
  shareId: r.share_id,
  createdAt: r.created_at,
})

/** Fields of ReportRow that updateReport may change, mapped to columns. */
const REPORT_COLUMNS = new Map<string, string>([
  ['status', 'status'],
  ['progress', 'progress'],
  ['total', 'total'],
  ['content', 'content_json'],
  ['error', 'error'],
  ['failures', 'failures'],
  ['shareId', 'share_id'],
  ['subject', 'subject'],
  ['question', 'question'],
])

/** `now` is injectable for tests. Expired chats (and everything under them) read as not found. */
export function createDb(d1: D1Database, now: () => number = Date.now) {
  /** Removes a chat with its chunks and reports, in one atomic batch. */
  const deleteChat = async (id: string): Promise<void> => {
    await d1.batch([
      d1.prepare('DELETE FROM reports WHERE chat_id = ?').bind(id),
      d1.prepare('DELETE FROM chat_chunks WHERE chat_id = ?').bind(id),
      d1.prepare('DELETE FROM chats WHERE id = ?').bind(id),
    ])
  }

  return {
    async insertChat(c: { name: string; uploaderName?: string | null; participants: string[]; stats: ChatStats; chunks: Chunk[]; expiresAt: number }): Promise<string> {
      const id = randomId()
      const statements: D1PreparedStatement[] = [
        d1
          .prepare(
            'INSERT INTO chats (id, name, participants_json, stats_json, created_at, expires_at, uploader_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(id, c.name, JSON.stringify(c.participants), JSON.stringify(c.stats), Date.now(), c.expiresAt, c.uploaderName ?? null),
        // Multi-row inserts keep the statement count low (D1 free plan: 50 queries per request) and
        // stay under 100 bound parameters per statement (3 per row).
        ...chunkRows(c.chunks, ROWS_PER_INSERT).map((rows) =>
          d1
            .prepare(`INSERT INTO chat_chunks (chat_id, idx, text, summary_json) VALUES ${rows.map(() => '(?, ?, ?, NULL)').join(', ')}`)
            .bind(...rows.flatMap((ch) => [id, ch.index, ch.text])),
        ),
      ]
      // The chat row goes first (chunks reference it). Each batch is atomic.
      for (let i = 0; i < statements.length; i += BATCH) {
        await d1.batch(statements.slice(i, i + BATCH))
      }
      return id
    },

    async getChat(id: string): Promise<ChatRow | null> {
      const row = await d1.prepare('SELECT * FROM chats WHERE id = ? AND expires_at > ?').bind(id, now()).first<ChatDbRow>()
      return row ? toChat(row) : null
    },

    async getChunks(chatId: string): Promise<ChunkRow[]> {
      const res = await d1
        .prepare(
          'SELECT k.chat_id, k.idx, k.text, k.summary_json FROM chat_chunks k JOIN chats c ON c.id = k.chat_id ' +
            'WHERE k.chat_id = ? AND c.expires_at > ? ORDER BY k.idx',
        )
        .bind(chatId, now())
        .all<ChunkDbRow>()
      return res.results.map(toChunk)
    },

    async saveSummary(chatId: string, idx: number, s: ChunkSummary): Promise<void> {
      await d1
        .prepare('UPDATE chat_chunks SET summary_json = ? WHERE chat_id = ? AND idx = ?')
        .bind(JSON.stringify(s), chatId, idx)
        .run()
    },

    async createReport(r: NewReport): Promise<string> {
      const id = randomId()
      await d1
        .prepare(
          'INSERT INTO reports (id, chat_id, persona, language, me, kind, subject, question, status, progress, total, created_at) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
        )
        .bind(
          id,
          r.chatId,
          r.persona,
          r.language,
          r.me,
          r.kind,
          r.subject ?? null,
          r.question ?? null,
          'queued',
          r.total ?? 0,
          Date.now(),
        )
        .run()
      return id
    },

    async getReport(id: string): Promise<ReportRow | null> {
      const row = await d1
        .prepare('SELECT r.* FROM reports r JOIN chats c ON c.id = r.chat_id WHERE r.id = ? AND c.expires_at > ?')
        .bind(id, now())
        .first<ReportDbRow>()
      return row ? toReport(row) : null
    },

    /**
     * Claims one attempt on a report BEFORE the model is called: failures + 1 and a lease, in one atomic
     * statement, only while the report is open and nobody else holds an unexpired lease. A crash after
     * this point therefore still counts as a failed attempt. 'busy' = someone else holds the lease,
     * 'closed' = done or failed, null = no such report (or its chat expired).
     */
    async claimAttempt(
      id: string,
      _maxFailures: number,
      leaseMs: number,
    ): Promise<{ outcome: 'claimed'; failures: number; token: number } | { outcome: 'busy' } | { outcome: 'closed' } | null> {
      const t = now()
      const row = await d1
        .prepare(
          "UPDATE reports SET failures = failures + 1, lease_until = ?, status = 'running' " +
            "WHERE id = ? AND status NOT IN ('done', 'failed') AND (lease_until IS NULL OR lease_until <= ?) " +
            'AND chat_id IN (SELECT id FROM chats WHERE expires_at > ?) RETURNING failures',
        )
        .bind(t + leaseMs, id, t, t)
        .first<{ failures: number }>()
      // The fencing token is the lease expiry this claim wrote: a later claim can only happen after it passed.
      if (row) return { outcome: 'claimed', failures: row.failures, token: t + leaseMs }
      const current = await this.getReport(id)
      if (!current) return null
      return current.status === 'done' || current.status === 'failed' ? { outcome: 'closed' } : { outcome: 'busy' }
    },

    /** A successful step: progress up, failure counter reset, lease released. Only while the report is open. */
    async advanceProgress(id: string, p: { progress: number; total: number }, token: number): Promise<boolean> {
      const res = await d1
        .prepare(
          "UPDATE reports SET progress = ?, total = ?, failures = 0, error = NULL, lease_until = NULL, status = 'running' " +
            "WHERE id = ? AND status NOT IN ('done', 'failed') AND lease_until = ?",
        )
        .bind(p.progress, p.total, id, token)
        .run()
      return res.meta.changes > 0
    },

    /** The final write. Only while the report is open, so a late call cannot overwrite a failed report. */
    async finishReport(id: string, content: GroupReport, total: number, token: number): Promise<boolean> {
      const res = await d1
        .prepare(
          "UPDATE reports SET status = 'done', progress = ?, total = ?, content_json = ?, error = NULL, failures = 0, lease_until = NULL " +
            "WHERE id = ? AND status NOT IN ('done', 'failed') AND lease_until = ?",
        )
        .bind(total, total, JSON.stringify(content), id, token)
        .run()
      return res.meta.changes > 0
    },

    /** Records a failed attempt (the attempt was already counted by claimAttempt) and releases the lease. */
    async failAttempt(id: string, code: string, maxFailures: number, token: number): Promise<{ status: ReportStatus; progress: number } | null> {
      return d1
        .prepare(
          "UPDATE reports SET error = ?, lease_until = NULL, status = CASE WHEN failures >= ? THEN 'failed' ELSE 'running' END " +
            "WHERE id = ? AND status NOT IN ('done', 'failed') AND lease_until = ? RETURNING status, progress",
        )
        .bind(code, maxFailures, id, token)
        .first<{ status: ReportStatus; progress: number }>()
    },

    /** Marks a report failed outright (for example after too many counted attempts). */
    async failReport(id: string, code: string): Promise<void> {
      await d1
        .prepare("UPDATE reports SET status = 'failed', error = ?, lease_until = NULL WHERE id = ? AND status <> 'done'")
        .bind(code, id)
        .run()
    },

    /** Updates only the known fields in patch. Other keys are ignored. undefined is skipped. */
    async updateReport(id: string, patch: Partial<ReportRow>): Promise<void> {
      const sets: string[] = []
      const values: (string | number | null)[] = []
      for (const [key, value] of Object.entries(patch)) {
        const column = REPORT_COLUMNS.get(key)
        if (!column || value === undefined) continue
        sets.push(`${column} = ?`)
        values.push(key === 'content' && value !== null ? JSON.stringify(value) : (value as string | number | null))
      }
      if (sets.length === 0) return
      await d1
        .prepare(`UPDATE reports SET ${sets.join(', ')} WHERE id = ?`)
        .bind(...values, id)
        .run()
    },

    async setShare(id: string, shareId: string | null): Promise<void> {
      await d1.prepare('UPDATE reports SET share_id = ? WHERE id = ?').bind(shareId, id).run()
    },

    async getReportByShare(shareId: string): Promise<ReportRow | null> {
      const row = await d1
        .prepare('SELECT r.* FROM reports r JOIN chats c ON c.id = r.chat_id WHERE r.share_id = ? AND c.expires_at > ?')
        .bind(shareId, now())
        .first<ReportDbRow>()
      return row ? toReport(row) : null
    },

    deleteChat,

    /**
     * Deletes a report. If that leaves its chat with no reports, the chat and its stored text go too, in
     * the same atomic batch, so the outcome never depends on what a browser thinks it has left.
     */
    async deleteReport(id: string): Promise<void> {
      const row = await d1.prepare('SELECT chat_id FROM reports WHERE id = ?').bind(id).first<{ chat_id: string }>()
      if (!row) return
      const orphan = 'NOT EXISTS (SELECT 1 FROM reports r WHERE r.chat_id = ?)'
      await d1.batch([
        d1.prepare('DELETE FROM reports WHERE id = ?').bind(id),
        d1.prepare(`DELETE FROM chat_chunks WHERE chat_id = ? AND ${orphan}`).bind(row.chat_id, row.chat_id),
        d1.prepare(`DELETE FROM chats WHERE id = ? AND ${orphan}`).bind(row.chat_id, row.chat_id),
      ])
    },

    /**
     * Physically deletes chats whose expires_at is at or before `at`, in one batch of three set-based
     * statements (a fixed number of queries, whatever the backlog). Returns how many chats were removed.
     */
    async deleteExpired(at: number): Promise<number> {
      const res = await d1.batch([
        d1.prepare('DELETE FROM reports WHERE chat_id IN (SELECT id FROM chats WHERE expires_at <= ?)').bind(at),
        d1.prepare('DELETE FROM chat_chunks WHERE chat_id IN (SELECT id FROM chats WHERE expires_at <= ?)').bind(at),
        d1.prepare('DELETE FROM chats WHERE expires_at <= ?').bind(at),
      ])
      return res[2].meta.changes
    },
  }
}

export type Db = ReturnType<typeof createDb>
