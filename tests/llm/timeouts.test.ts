import { afterEach, describe, expect, it, vi } from 'vitest'
import { GeminiProvider } from '../../src/llm/gemini'
import { OpenRouterProvider } from '../../src/llm/openrouter'

afterEach(() => {
  vi.unstubAllGlobals()
})

function capture(body: unknown) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('upstream calls are time-bounded', () => {
  it('gemini passes an AbortSignal to fetch', async () => {
    const f = capture({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] })
    await new GeminiProvider('k').generate({ system: 's', prompt: 'p' })
    expect(f.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('openrouter passes an AbortSignal to fetch', async () => {
    const f = capture({ choices: [{ message: { content: 'hi' } }] })
    await new OpenRouterProvider('k', 'm').generate({ system: 's', prompt: 'p' })
    expect(f.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
  })
})
