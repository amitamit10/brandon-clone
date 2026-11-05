/** Typed helpers for the owner's admin API (/api/admin). Credentials are the session cookie only. */

/** The server answered with an error status. `code` is the short error string it sent, when it sent one. */
export class AdminError extends Error {
  constructor(
    public status: number,
    public code: string | null = null,
  ) {
    super(`admin HTTP ${status}${code ? ` (${code})` : ''}`)
    this.name = 'AdminError'
  }
}

export interface DailyRow {
  day: string
  uploads: number
  reportsCreated: number
  reportsDone: number
  reportsFailed: number
  llmCalls: number
  llmFails: number
  rateLimited: number
  visitors: number
  uploadKB: number
}

export interface Overview {
  totals: {
    chatsActive: number
    chatsAll: number
    reportsAll: number
    reportsByStatus: Record<string, number>
    reportsByKind: Record<string, number>
    reportsByPersona: Record<string, number>
    sharedLinks: number
    storedChunkKB: number
    contentViews: number
  }
  daily: DailyRow[]
  llmByModel: { key: string; calls: number; fails: number; rate429: number }[]
  avgReportSeconds: number | null
  adminLoginFailed: number
}

export interface ChatSummary {
  id: string
  id8: string
  groupName: string
  uploaderName: string
  participantNames: string[]
  participants: number
  messages: number
  chunks: number
  reports: number
  reportsDone: number
  hasShared: boolean
  createdAt: number
  expiresAt: number
  expired: boolean
}

export interface ReportView {
  id: string
  id8: string
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
  createdAt: number
  shared: boolean
  content: ReportContent | null
}

export interface ReportContent {
  title?: string
  intro?: string
  verdict?: string
  dynamic?: string
  sections?: { heading?: string; body?: string }[]
  members?: { name?: string; nickname?: string; opinion?: string; quote?: string }[]
  advice?: string
}

export interface ChatDetail extends Omit<ChatSummary, 'reports'> {
  reports: ReportView[]
}

export interface Uploader {
  uploaderName: string
  chats: number
  reports: number
  lastSeen: number
}

async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  // The custom header cannot be sent by a cross-site form, so it marks requests the page itself made.
  if (method !== 'GET') headers['X-Admin'] = '1'
  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    })
  } catch {
    throw new AdminError(0, 'network')
  }
  if (!res.ok) {
    let code: string | null = null
    try {
      const data = (await res.json()) as { error?: unknown }
      if (typeof data?.error === 'string') code = data.error
    } catch {
      // Error bodies are optional.
    }
    throw new AdminError(res.status, code)
  }
  return (await res.json()) as T
}

const enc = encodeURIComponent

export const adminApi = {
  login: (token: string) => call<{ ok: true }>('POST', '/api/admin/login', { token }),
  logout: () => call<{ ok: true }>('POST', '/api/admin/logout'),
  overview: (days = 30) => call<Overview>('GET', `/api/admin/overview?days=${enc(String(days))}`),
  listChats: (opts: { q?: string; limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams({ limit: String(opts.limit ?? 50), offset: String(opts.offset ?? 0) })
    if (opts.q) params.set('q', opts.q)
    return call<{ chats: ChatSummary[]; total: number }>('GET', `/api/admin/chats?${params.toString()}`)
  },
  getChat: (id: string) => call<ChatDetail>('GET', `/api/admin/chats/${enc(id)}`),
  getMessages: (id: string, chunk: number) =>
    call<{ chunk: number; chunks: number; text: string }>('GET', `/api/admin/chats/${enc(id)}/messages?chunk=${enc(String(chunk))}`),
  listUploaders: () => call<{ uploaders: Uploader[] }>('GET', '/api/admin/uploaders'),
  deleteChat: (id: string) => call<{ ok: true }>('DELETE', `/api/admin/chats/${enc(id)}`),
  deleteReport: (id: string) => call<{ ok: true }>('DELETE', `/api/admin/reports/${enc(id)}`),
  unshareReport: (id: string) => call<{ ok: true }>('POST', `/api/admin/reports/${enc(id)}/unshare`),
}
