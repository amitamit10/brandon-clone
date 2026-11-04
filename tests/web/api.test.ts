import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, NetworkError, createReport, uploadChat } from '../../web/lib/api'
import { apiErrorMessage } from '../../web/lib/messages'
import { readHistory, addHistory } from '../../web/lib/history'

const body = {
  name: 'The Boys',
  participants: ['Ana'],
  stats: {} as never,
  chunks: [],
}

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('api helpers', () => {
  it('uploadChat posts JSON and resolves with the chat id', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 201, json: async () => ({ id: 'c1' }) }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(uploadChat(body)).resolves.toBe('c1')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/chats')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string).name).toBe('The Boys')
  })

  it('createReport posts to the chat-scoped route', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 201, json: async () => ({ id: 'r1' }) }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createReport('c1', { persona: 'clara', language: 'Hebrew', me: 'Ana', kind: 'group' })).resolves.toBe('r1')
    expect(fetchMock.mock.calls.length).toBe(1)
    expect(fetchMock.mock.calls[0]).toEqual(expect.arrayContaining(['/api/chats/c1/reports']))
  })

  it('maps an error status to a typed ApiError carrying the server code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 413, json: async () => ({ error: 'too_big' }) })))

    const error = await uploadChat(body).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(413)
    expect((error as ApiError).code).toBe('too_big')
    expect(apiErrorMessage(error)).toBe('That chat is too large to process. Try a shorter export.')
  })

  it('maps a failed fetch to NetworkError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))))

    const error = await uploadChat(body).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(NetworkError)
    expect(apiErrorMessage(error)).toContain("couldn't reach the server")
  })

  it('treats a success without an id as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })))
    const error = await createReport('c1', { persona: 'brandon', language: 'English', me: 'Ana', kind: 'group' }).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(ApiError)
  })

  it('maps 422, 429 and 503 to plain messages', () => {
    expect(apiErrorMessage(new ApiError(422))).toContain("couldn't use this chat")
    expect(apiErrorMessage(new ApiError(429))).toContain('made a lot of requests')
    expect(apiErrorMessage(new ApiError(503))).toContain('busy right now')
  })
})

describe('history storage', () => {
  it('stores and reads entries, newest first', () => {
    addHistory({ chatId: 'c1', reportId: 'r1', name: 'A', createdAt: 1 })
    addHistory({ chatId: 'c2', reportId: 'r2', name: 'B', createdAt: 2 })
    expect(readHistory().map((e) => e.chatId)).toEqual(['c2', 'c1'])
  })

  it('returns an empty list when the stored value is corrupt', () => {
    window.localStorage.setItem('brandon.history', '{not json')
    expect(readHistory()).toEqual([])
  })
})
