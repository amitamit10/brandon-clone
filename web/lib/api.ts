import type { ChatStats, Chunk, GroupReport, PersonaId } from '../../src/shared/types'

/** The server answered with an error status. `code` is the server's error string when it sent one. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string | null = null,
  ) {
    super(`HTTP ${status}${code ? ` (${code})` : ''}`)
    this.name = 'ApiError'
  }
}

/** The request never got an answer (offline, DNS, CORS, aborted, body unreadable). */
export class NetworkError extends Error {
  constructor() {
    super('network error')
    this.name = 'NetworkError'
  }
}

export type ReportStatus = 'queued' | 'running' | 'done' | 'failed'
export type ReportKind = 'group' | 'member' | 'followup'

/** GET /api/reports/:id. `content` is only present once the report is done. */
export interface ReportView {
  status: ReportStatus
  progress: number
  total: number
  persona: PersonaId
  language: string
  kind: ReportKind
  subject: string | null
  error: string | null
  content?: GroupReport
}

/** POST /api/reports/:id/advance. */
export interface JobState {
  status: ReportStatus
  phase: string
  progress: number
  total: number
  error: string | null
}

/** GET /api/shared/:id. Only ever a finished report. */
export interface SharedReport {
  groupName: string
  persona: PersonaId
  language: string
  content: GroupReport
}

export interface UploadChatBody {
  name: string
  /** The uploader's own name, self-declared. Stored with the chat. */
  uploaderName: string
  participants: string[]
  stats: ChatStats
  chunks: Chunk[]
}

interface ReportSettings {
  persona: PersonaId
  language: string
  me: string
}

export type CreateReportBody =
  | (ReportSettings & { kind: 'group' })
  | (ReportSettings & { kind: 'member'; subject: string })
  | (ReportSettings & { kind: 'followup'; question: string })

const REPORT_STATUSES: ReadonlySet<string> = new Set(['queued', 'running', 'done', 'failed'])

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/**
 * One fetch for every helper. Network failures become NetworkError, error statuses become ApiError
 * (with the server's short code when it sent one), and a body that is not JSON becomes bad_response.
 */
async function request(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new NetworkError()
  }
  if (!res.ok) {
    let code: string | null = null
    try {
      const data = (await res.json()) as { error?: unknown }
      if (typeof data?.error === 'string') code = data.error
    } catch {
      // Error bodies are optional.
    }
    throw new ApiError(res.status, code)
  }
  try {
    return await res.json()
  } catch {
    throw new ApiError(res.status, 'bad_response')
  }
}

const enc = encodeURIComponent

function requireString(data: unknown, key: string): string {
  const value = isRecord(data) ? data[key] : undefined
  if (typeof value !== 'string' || value.length === 0) throw new ApiError(500, 'bad_response')
  return value
}

/**
 * Model output is shown as-is, so missing or mistyped fields become empty values here instead of
 * crashing the page. Nothing is turned into markup.
 */
export function normalizeReport(raw: unknown): GroupReport {
  if (!isRecord(raw)) throw new ApiError(500, 'bad_response')
  const text = (x: unknown) => (typeof x === 'string' ? x : '')
  const list = <T>(x: unknown, map: (item: unknown) => T | null): T[] =>
    Array.isArray(x) ? x.map(map).filter((v): v is T => v !== null) : []
  return {
    title: text(raw.title),
    intro: text(raw.intro),
    verdict: text(raw.verdict),
    dynamic: text(raw.dynamic),
    shiftWeekNote: text(raw.shiftWeekNote),
    runningJokes: list(raw.runningJokes, (j) => (typeof j === 'string' && j.trim() ? j : null)),
    sections: list(raw.sections, (s) =>
      isRecord(s) ? { emoji: text(s.emoji), heading: text(s.heading), body: text(s.body) } : null,
    ),
    members: list(raw.members, (m) =>
      isRecord(m)
        ? {
            name: text(m.name),
            nickname: text(m.nickname),
            opinion: text(m.opinion),
            ...(typeof m.quote === 'string' && m.quote.length > 0 ? { quote: m.quote } : {}),
          }
        : null,
    ),
    advice: text(raw.advice),
  }
}

function toReportView(data: unknown): ReportView {
  if (!isRecord(data) || typeof data.status !== 'string' || !REPORT_STATUSES.has(data.status)) {
    throw new ApiError(500, 'bad_response')
  }
  const view = data as unknown as ReportView
  return {
    ...view,
    progress: typeof data.progress === 'number' ? data.progress : 0,
    total: typeof data.total === 'number' ? data.total : 0,
    subject: typeof data.subject === 'string' ? data.subject : null,
    error: typeof data.error === 'string' ? data.error : null,
    ...(data.content !== undefined ? { content: normalizeReport(data.content) } : {}),
  }
}

/** Stores an analysed chat. Resolves with the new chat id. */
export async function uploadChat(body: UploadChatBody): Promise<string> {
  return requireString(await request('POST', '/api/chats', body), 'chatId')
}

/** Starts a group, member or follow-up report for a stored chat. Resolves with the new report id. */
export async function createReport(chatId: string, body: CreateReportBody): Promise<string> {
  return requireString(await request('POST', `/api/chats/${enc(chatId)}/reports`, body), 'reportId')
}

export async function getReport(reportId: string): Promise<ReportView> {
  return toReportView(await request('GET', `/api/reports/${enc(reportId)}`))
}

/** Runs one step of the job on the server. The caller decides when to call again. */
export async function advance(reportId: string): Promise<JobState> {
  const data = await request('POST', `/api/reports/${enc(reportId)}/advance`)
  if (!isRecord(data) || typeof data.status !== 'string' || !REPORT_STATUSES.has(data.status)) {
    throw new ApiError(500, 'bad_response')
  }
  return {
    status: data.status as ReportStatus,
    phase: typeof data.phase === 'string' ? data.phase : '',
    progress: typeof data.progress === 'number' ? data.progress : 0,
    total: typeof data.total === 'number' ? data.total : 0,
    error: typeof data.error === 'string' ? data.error : null,
  }
}

/** Creates a share link. Resolves with the share id (the path part of /s/<id>). */
export async function shareReport(reportId: string): Promise<string> {
  return requireString(await request('POST', `/api/reports/${enc(reportId)}/share`), 'shareId')
}

export async function unshareReport(reportId: string): Promise<void> {
  await request('DELETE', `/api/reports/${enc(reportId)}/share`)
}

export async function deleteReport(reportId: string): Promise<void> {
  await request('DELETE', `/api/reports/${enc(reportId)}`)
}

export async function deleteChat(chatId: string): Promise<void> {
  await request('DELETE', `/api/chats/${enc(chatId)}`)
}

export async function getShared(shareId: string): Promise<SharedReport> {
  const data = await request('GET', `/api/shared/${enc(shareId)}`)
  if (!isRecord(data) || typeof data.groupName !== 'string' || typeof data.persona !== 'string') {
    throw new ApiError(500, 'bad_response')
  }
  return {
    groupName: data.groupName,
    persona: data.persona as PersonaId,
    language: typeof data.language === 'string' ? data.language : '',
    content: normalizeReport(data.content),
  }
}
