import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProviderFromEnv, DEFAULT_GEMINI_MODELS } from '../../src/llm/index'
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

  it('tries the Gemini models in order and falls through to the next one on a 503', async () => {
    const urls: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      urls.push(url)
      return urls.length === 1 ? new Response('{"error":{"code":503}}', { status: 503 }) : geminiOk()
    })
    vi.stubGlobal('fetch', fetchMock)
    const out = await createProviderFromEnv(env({ GEMINI_API_KEY: 'g-key', GEMINI_MODELS: 'model-a,model-b' })).generate({ system: 's', prompt: 'p' })
    expect(out.text).toBe('g')
    expect(urls[0]).toContain('/models/model-a:')
    expect(urls[1]).toContain('/models/model-b:')
  })

  it('ignores invalid model names and uses the default chain when none are valid', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (urls.push(url), geminiOk())))
    await createProviderFromEnv(env({ GEMINI_API_KEY: 'g-key', GEMINI_MODELS: '../evil, ,a b' })).generate({ system: 's', prompt: 'p' })
    expect(urls[0]).toContain(`/models/${DEFAULT_GEMINI_MODELS[0]}:`)
    expect(urls[0]).not.toContain('evil')
  })

  it('the default chain has several distinct models and none of the retired ones', () => {
    expect(new Set(DEFAULT_GEMINI_MODELS).size).toBeGreaterThanOrEqual(3)
    expect(DEFAULT_GEMINI_MODELS).not.toContain('gemini-2.5-flash')
  })
})

