import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  NetworkError,
  advance,
  createReport,
  deleteChat,
  deleteReport,
  getReport,
  getShared,
  normalizeReport,
  shareReport,
  unshareReport,
} from '../../web/lib/api'

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

function stubFetch(impl: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => impl(url, init ?? {}))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('report api helpers', () => {
  it('posts a follow-up with exactly the agreed body shape', async () => {
    const fetchMock = stubFetch(() => jsonResponse(201, { reportId: 'r2' }))
    const id = await createReport('c1', {
      persona: 'clara',
      language: 'Hebrew',
      me: 'Ana',
      kind: 'followup',
      question: 'Who owes who?',
    })
    expect(id).toBe('r2')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/chats/c1/reports')
    expect(JSON.parse(init.body as string)).toEqual({
      persona: 'clara',
      language: 'Hebrew',
      me: 'Ana',
      kind: 'followup',
      question: 'Who owes who?',
    })
  })

  it('advance posts to the job route and returns the job state', async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse(200, { status: 'running', phase: 'summarizing', progress: 3, total: 9, error: null }),
    )
    const state = await advance('r1')
    expect(state).toEqual({ status: 'running', phase: 'summarizing', progress: 3, total: 9, error: null })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/reports/r1/advance')
    expect(init.method).toBe('POST')
  })

  it('advance rejects a body without a known status as bad_response', async () => {
    stubFetch(() => jsonResponse(200, { status: 'weird' }))
    await expect(advance('r1')).rejects.toMatchObject({ name: 'ApiError', code: 'bad_response' })
  })

  it('maps a network failure to NetworkError on every helper', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch')
    })
    await expect(getReport('r1')).rejects.toBeInstanceOf(NetworkError)
    await expect(advance('r1')).rejects.toBeInstanceOf(NetworkError)
    await expect(deleteReport('r1')).rejects.toBeInstanceOf(NetworkError)
    await expect(getShared('s1')).rejects.toBeInstanceOf(NetworkError)
  })

  it('keeps the server error code on an ApiError', async () => {
    stubFetch(() => jsonResponse(429, { error: 'rate_limited' }))
    const err = await advance('r1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(429)
    expect((err as ApiError).code).toBe('rate_limited')
  })

  it('getReport returns the status, and content only when present', async () => {
    stubFetch(() => jsonResponse(200, { status: 'running', progress: 1, total: 4, persona: 'diego', language: 'English', kind: 'group', subject: null, error: null }))
    const running = await getReport('r1')
    expect(running.status).toBe('running')
    expect(running.content).toBeUndefined()
    expect(running.persona).toBe('diego')
  })

  it('share, unshare and delete call the agreed routes', async () => {
    const fetchMock = stubFetch((url) => (url.endsWith('/share') ? jsonResponse(200, { shareId: 'abc' }) : jsonResponse(200, { ok: true })))
    expect(await shareReport('r1')).toBe('abc')
    await unshareReport('r1')
    await deleteReport('r1')
    await deleteChat('c1')
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][]
    expect(calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      'POST /api/reports/r1/share',
      'DELETE /api/reports/r1/share',
      'DELETE /api/reports/r1',
      'DELETE /api/chats/c1',
    ])
  })

  it('getShared reads the shared route and normalises the content', async () => {
    stubFetch(() =>
      jsonResponse(200, {
        groupName: 'The Boys',
        persona: 'brandon',
        language: 'English',
        content: { title: 'T', sections: [{ emoji: '🍻', heading: 'H', body: 'B' }, 'junk'] },
      }),
    )
    const shared = await getShared('s1')
    expect(shared.groupName).toBe('The Boys')
    expect(shared.content.title).toBe('T')
    expect(shared.content.sections).toEqual([{ emoji: '🍻', heading: 'H', body: 'B' }])
    expect(shared.content.members).toEqual([])
  })

  it('normalizeReport turns missing or mistyped model fields into empty values', () => {
    const report = normalizeReport({ title: 42, members: [{ name: 'Ana', quote: '' }, null], runningJokes: ['ok', '  '] })
    expect(report.title).toBe('')
    expect(report.members).toEqual([{ name: 'Ana', nickname: '', opinion: '' }])
    expect(report.runningJokes).toEqual(['ok'])
    expect(report.sections).toEqual([])
  })

  it('normalizeReport preserves member aura metrics and quotes', () => {
    const report = normalizeReport({
      members: [
        {
          name: 'Amit',
          aura: {
            score: '+50,000',
            status: 'מלך האורה',
            peak: { points: '+20,000', reason: 'cool line', quote: 'hi' },
            loss: { points: '-5,000', reason: 'late', quote: 'bye' },
          },
        },
      ],
    })
    expect(report.members[0].aura).toEqual({
      score: '+50,000',
      status: 'מלך האורה',
      peak: { points: '+20,000', reason: 'cool line', quote: 'hi' },
      loss: { points: '-5,000', reason: 'late', quote: 'bye' },
    })
  })
})
