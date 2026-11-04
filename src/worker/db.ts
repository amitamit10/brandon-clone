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
  shareId: string | null
  createdAt: number
}

/** Statements per D1 batch. Keeps each batch well under D1 limits; a batch is atomic. */
const BATCH = 50

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
  share_id: string | null
  created_at: number
}

const parse = <T>(s: string | null): T | null => (s === null ? null : (JSON.parse(s) as T))

const toChat = (r: ChatDbRow): ChatRow => ({
  id: r.id,
  name: r.name,
  participants: JSON.parse(r.participants_json) as string[],
  stats: JSON.parse(r.stats_json) as ChatStats,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
})
const toChunk = (r: ChunkDbRow): ChunkRow => ({
  chatId: r.chat_id,
  idx: r.idx,
  text: r.text,
  summary: parse<ChunkSummary>(r.summary_json),
})
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
  ['shareId', 'share_id'],
  ['subject', 'subject'],
  ['question', 'question'],
])

export function createDb(d1: D1Database) {
  /** Removes a chat with its chunks and reports, in one atomic batch. */
  const deleteChat = async (id: string): Promise<void> => {
    await d1.batch([
      d1.prepare('DELETE FROM reports WHERE chat_id = ?').bind(id),
      d1.prepare('DELETE FROM chat_chunks WHERE chat_id = ?').bind(id),
      d1.prepare('DELETE FROM chats WHERE id = ?').bind(id),
    ])
  }

  return {
    async insertChat(c: { name: string; participants: string[]; stats: ChatStats; chunks: Chunk[]; expiresAt: number }): Promise<string> {
      const id = randomId()
      const statements: D1PreparedStatement[] = [
        d1
          .prepare('INSERT INTO chats (id, name, participants_json, stats_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(id, c.name, JSON.stringify(c.participants), JSON.stringify(c.stats), Date.now(), c.expiresAt),
        ...c.chunks.map((ch) =>
          d1.prepare('INSERT INTO chat_chunks (chat_id, idx, text, summary_json) VALUES (?, ?, ?, NULL)').bind(id, ch.index, ch.text),
        ),
      ]
      // The chat row goes first (chunks reference it). Each batch is atomic.
      for (let i = 0; i < statements.length; i += BATCH) {
        await d1.batch(statements.slice(i, i + BATCH))
      }
      return id
    },

    async getChat(id: string): Promise<ChatRow | null> {
      const row = await d1.prepare('SELECT * FROM chats WHERE id = ?').bind(id).first<ChatDbRow>()
      return row ? toChat(row) : null
    },

    async getChunks(chatId: string): Promise<ChunkRow[]> {
      const res = await d1
        .prepare('SELECT chat_id, idx, text, summary_json FROM chat_chunks WHERE chat_id = ? ORDER BY idx')
        .bind(chatId)
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
      const row = await d1.prepare('SELECT * FROM reports WHERE id = ?').bind(id).first<ReportDbRow>()
      return row ? toReport(row) : null
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
      const row = await d1.prepare('SELECT * FROM reports WHERE share_id = ?').bind(shareId).first<ReportDbRow>()
      return row ? toReport(row) : null
    },

    deleteChat,

    async deleteReport(id: string): Promise<void> {
      await d1.prepare('DELETE FROM reports WHERE id = ?').bind(id).run()
    },

    /** Deletes chats whose expires_at is at or before now. Returns how many chats were removed. */
    async deleteExpired(now: number): Promise<number> {
      const res = await d1.prepare('SELECT id FROM chats WHERE expires_at <= ?').bind(now).all<{ id: string }>()
      for (const { id } of res.results) {
        await deleteChat(id)
      }
      return res.results.length
    },
  }
}

export type Db = ReturnType<typeof createDb>
