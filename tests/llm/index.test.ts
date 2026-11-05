import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProviderFromEnv, DEFAULT_GEMINI_MODELS, DEFAULT_OPENROUTER_MODELS, REPORT_GEMINI_MODELS } from '../../src/llm/index'
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

  it('uses nemotron on OpenRouter by default and lets OPENROUTER_MODEL override it', async () => {
    const models: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        models.push(JSON.parse(String(init?.body)).model)
        return openrouterOk()
      }),
    )
    await createProviderFromEnv(env({ OPENROUTER_API_KEY: 'o-key' })).generate({ system: 's', prompt: 'p' })
    await createProviderFromEnv(env({ OPENROUTER_API_KEY: 'o-key', OPENROUTER_MODEL: 'vendor/other:free' })).generate({ system: 's', prompt: 'p' })
    expect(models).toEqual(['nvidia/nemotron-3.5-super-vl:free', 'vendor/other:free'])
  })

  it('the report step tries the stronger Gemini models first, the summary step starts with the fast one', async () => {
    const firstModel = async (purpose?: 'summary' | 'report') => {
      const urls: string[] = []
      vi.stubGlobal('fetch', vi.fn(async (url: string) => (urls.push(url), geminiOk())))
      await createProviderFromEnv(env({ GEMINI_API_KEY: 'g-key' }), purpose).generate({ system: 's', prompt: 'p' })
      return urls[0]
    }
    expect(await firstModel('summary')).toContain(`/models/${DEFAULT_GEMINI_MODELS[0]}:`)
    expect(await firstModel()).toContain(`/models/${DEFAULT_GEMINI_MODELS[0]}:`)
    expect(await firstModel('report')).toContain(`/models/${REPORT_GEMINI_MODELS[0]}:`)
    expect(REPORT_GEMINI_MODELS[0]).not.toBe(DEFAULT_GEMINI_MODELS[0])
    expect(REPORT_GEMINI_MODELS.some((m) => m.includes('lite'))).toBe(true) // lite is only the last resort
    expect(REPORT_GEMINI_MODELS.findIndex((m) => m.includes('lite'))).toBe(REPORT_GEMINI_MODELS.length - 1)
  })

  it('chains OpenRouter models: a failing first model falls through to the second', async () => {
    const models: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        models.push(JSON.parse(String(init?.body)).model)
        return models.length === 1 ? new Response('{}', { status: 429, headers: { 'retry-after': '1' } }) : openrouterOk()
      }),
    )
    const out = await createProviderFromEnv(env({ OPENROUTER_API_KEY: 'o-key', OPENROUTER_MODELS: 'vendor/a:free,vendor/b:free' })).generate({ system: 's', prompt: 'p' })
    expect(out.text).toBe('o')
    expect(models).toEqual(['vendor/a:free', 'vendor/b:free'])
  })

  it('the default OpenRouter chain has nemotron first and distinct free fallbacks', () => {
    expect(DEFAULT_OPENROUTER_MODELS[0]).toBe('nvidia/nemotron-3.5-super-vl:free')
    expect(new Set(DEFAULT_OPENROUTER_MODELS).size).toBeGreaterThanOrEqual(2)
    expect(DEFAULT_OPENROUTER_MODELS.every((m) => m.endsWith(':free') || m.startsWith('stealth/'))).toBe(true)
  })
})

