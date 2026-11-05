import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProviderFromEnv, type LlmCallInfo } from '../../src/llm/index'
import { RateLimitError } from '../../src/llm/provider'
import type { Env } from '../../src/worker/index'
import { fakeProvider, defaultReply } from './support'

afterEach(() => {
  vi.unstubAllGlobals()
})

const baseEnv = { GEMINI_API_KEY: 'g-key', OPENROUTER_API_KEY: 'o-key', GEMINI_MODELS: 'gemini-a-1' } as unknown as Env

describe('createProviderFromEnv hooks', () => {
  it('reports every underlying attempt, not the fallback wrapper', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('generativelanguage')) return new Response('{}', { status: 429 })
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 })
      }),
    )
    const calls: LlmCallInfo[] = []
    const provider = createProviderFromEnv(baseEnv, { onCall: (info) => void calls.push(info) })
    const out = await provider.generate({ system: 's', prompt: 'p' })
    expect(out.text).toBe('{"ok":true}')
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({ provider: 'gemini', model: 'gemini-a-1', ok: false, rateLimited: true })
    expect(calls[1]).toMatchObject({ provider: 'openrouter', ok: true, rateLimited: false })
    expect(calls[1].ms).toBeGreaterThanOrEqual(0)
  })

  it('ignores a throwing hook and still returns the reply', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), { status: 200 })))
    const provider = createProviderFromEnv({ OPENROUTER_API_KEY: 'o' } as unknown as Env, {
      onCall: () => {
        throw new Error('hook broke')
      },
    })
    await expect(provider.generate({ system: 's', prompt: 'p' })).resolves.toEqual({ text: 'hi' })
  })

  it('keeps RateLimitError identity through the instrumented provider', async () => {
    const { instrument } = await import('../../src/llm/index')
    const inner = { name: 'gemini', model: 'm-x', generate: async () => { throw new RateLimitError('slow down') } }
    const seen: LlmCallInfo[] = []
    const wrapped = instrument(inner, { onCall: (i) => void seen.push(i) })
    await expect(wrapped.generate({ system: 's', prompt: 'p' })).rejects.toBeInstanceOf(RateLimitError)
    expect(seen[0]).toMatchObject({ provider: 'gemini', model: 'm-x', ok: false, rateLimited: true })
  })

  it('fake provider wrapped by instrument still answers', async () => {
    const { instrument } = await import('../../src/llm/index')
    const base = fakeProvider(defaultReply)
    const wrapped = instrument(base, {})
    await expect(wrapped.generate({ system: 's', prompt: 'p' })).resolves.toHaveProperty('text')
  })
})
