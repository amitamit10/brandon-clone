import type { ChatStats, Chunk, PersonaId } from '../../src/shared/types'

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

/** The request never got an answer (offline, DNS, CORS, aborted). */
export class NetworkError extends Error {
  constructor() {
    super('network error')
    this.name = 'NetworkError'
  }
}

export interface UploadChatBody {
  name: string
  /** The uploader's own name, self-declared. Stored with the chat. */
  uploaderName: string
  participants: string[]
  stats: ChatStats
  chunks: Chunk[]
}

export interface CreateReportBody {
  persona: PersonaId
  language: string
  me: string
  kind: 'group'
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
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
  let data: unknown
  try {
    data = await res.json()
  } catch {
    throw new ApiError(res.status, 'bad_response')
  }
  return data as T
}

function requireId(data: unknown, key: 'chatId' | 'reportId'): string {
  const id = (data as Record<string, unknown> | null)?.[key]
  if (typeof id !== 'string' || id.length === 0) throw new ApiError(500, 'bad_response')
  return id
}

/** Stores an analysed chat. Resolves with the new chat id. */
export async function uploadChat(body: UploadChatBody): Promise<string> {
  return requireId(await postJson<unknown>('/api/chats', body), 'chatId')
}

/** Starts a report for a stored chat. Resolves with the new report id. */
export async function createReport(chatId: string, body: CreateReportBody): Promise<string> {
  return requireId(await postJson<unknown>(`/api/chats/${encodeURIComponent(chatId)}/reports`, body), 'reportId')
}
