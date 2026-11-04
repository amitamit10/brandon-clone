import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProviderFromEnv } from '../../src/llm/index'
import type { Env } from '../../src/worker/index'

const env = (over: Partial<Env>) => ({ DB: {} as D1Database, ASSETS: {} as Fetcher, ...over }) as Env

const geminiOk = () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'g' }] } }] }), { status: 200 })
const openrouterOk = () =>
  new Response(JSON.stringify({ choices: [{ message: { content: 'o' } }] }), { status: 200 })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createProviderFromEnv', () => {
  it('throws no_llm_key_configured when no key is set', () => {
    expect(() => createProviderFromEnv(env({}))).toThrow('no_llm_key_configured')
  })

  it('uses Gemini first by default and OpenRouter first when LLM_PRIMARY=openrouter', async () => {
    const fetchMock = vi.fn(async (url: string) => (url.includes('openrouter') ? openrouterOk() : geminiOk()))
    vi.stubGlobal('fetch', fetchMock)
    const both = { GEMINI_API_KEY: 'g-key', OPENROUTER_API_KEY: 'o-key' }

    expect((await createProviderFromEnv(env(both)).generate({ system: 's', prompt: 'p' })).text).toBe('g')
    expect((await createProviderFromEnv(env({ ...both, LLM_PRIMARY: 'openrouter' })).generate({ system: 's', prompt: 'p' })).text).toBe('o')
  })
})
