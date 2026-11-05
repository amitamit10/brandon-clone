import { afterEach, describe, expect, it, vi } from 'vitest'
import { GeminiProvider } from '../../src/llm/gemini'
import { OpenRouterProvider } from '../../src/llm/openrouter'
import { LLM_FETCH_TIMEOUT_MS, LLM_SLOW_FETCH_TIMEOUT_MS } from '../../src/llm/provider'
import { LEASE_MS } from '../../src/worker/jobs'

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

  it('openrouter allows a slow model: its call timeout is at least 150 s, Gemini stays at 60 s', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout')
    capture({ choices: [{ message: { content: 'hi' } }] })
    await new OpenRouterProvider('k', 'm').generate({ system: 's', prompt: 'p' })
    capture({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] })
    await new GeminiProvider('k').generate({ system: 's', prompt: 'p' })
    const [orMs, gemMs] = spy.mock.calls.map((c) => c[0] as number)
    spy.mockRestore()
    expect(orMs).toBeGreaterThanOrEqual(150_000)
    expect(gemMs).toBe(LLM_FETCH_TIMEOUT_MS)
  })

  it('the job lease outlives the slowest upstream call', () => {
    expect(LEASE_MS).toBeGreaterThan(LLM_SLOW_FETCH_TIMEOUT_MS)
  })
})

