import { afterEach, describe, expect, it, vi } from 'vitest'
import { GeminiProvider } from '../../src/llm/gemini'
import { RateLimitError } from '../../src/llm/provider'

const KEY = 'test-key-123'

function stubFetch(response: Response) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GeminiProvider', () => {
  it('maps HTTP 429 to RateLimitError with retryAfterMs from Retry-After seconds', async () => {
    stubFetch(new Response('{}', { status: 429, headers: { 'retry-after': '7' } }))
    const p = new GeminiProvider(KEY)
    const err = await p.generate({ system: 's', prompt: 'p' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RateLimitError)
    expect((err as RateLimitError).retryAfterMs).toBe(7000)
  })

  it('sends the key in the x-goog-api-key header, never in the URL', async () => {
    const fetchMock = stubFetch(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }), { status: 200 }),
    )
    const res = await new GeminiProvider(KEY).generate({ system: 's', prompt: 'p' })
    expect(res).toEqual({ text: 'hi' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).not.toContain(KEY)
    expect(new Headers(init?.headers).get('x-goog-api-key')).toBe(KEY)
  })

  it('asks for JSON output via responseMimeType when json is true', async () => {
    const fetchMock = stubFetch(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }), { status: 200 }),
    )
    await new GeminiProvider(KEY).generate({ system: 's', prompt: 'p', json: true })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.generationConfig.responseMimeType).toBe('application/json')
  })
})
