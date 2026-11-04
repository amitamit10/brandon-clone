import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createFallbackProvider,
  MAX_RETRY_WAIT_MS,
  generateJson,
  RateLimitError,
  type LlmProvider,
  type LlmRequest,
} from '../../src/llm/provider'

/** Provider that replays a script: each entry is a reply text or an Error to throw. */
function scripted(name: string, script: (string | Error)[]) {
  const calls: LlmRequest[] = []
  const provider: LlmProvider = {
    name,
    async generate(req) {
      calls.push(req)
      const next = script[Math.min(calls.length - 1, script.length - 1)]
      if (next instanceof Error) throw next
      return { text: next }
    },
  }
  return { provider, calls }
}

const req: LlmRequest = { system: 'sys', prompt: 'p', json: true }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createFallbackProvider', () => {
  it('falls through to the next provider on RateLimitError', async () => {
    const a = scripted('a', [new RateLimitError('429')])
    const b = scripted('b', ['from b'])
    const sleep = vi.fn(async () => {})
    const p = createFallbackProvider([a.provider, b.provider], { retries: 3, sleep })
    expect(await p.generate(req)).toEqual({ text: 'from b' })
    expect(a.calls).toHaveLength(1)
    expect(b.calls).toHaveLength(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('retries the same provider after retryAfterMs when only one provider', async () => {
    const a = scripted('a', [new RateLimitError('429', 500), 'ok'])
    const sleep = vi.fn(async () => {})
    const p = createFallbackProvider([a.provider], { retries: 3, sleep })
    expect(await p.generate(req)).toEqual({ text: 'ok' })
    expect(a.calls).toHaveLength(2)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(500)
  })

  it('throws after retries are exhausted with the last error object', async () => {
    const last = new RateLimitError('last')
    const a = scripted('a', [new Error('first'), last])
    const sleep = vi.fn(async () => {})
    const p = createFallbackProvider([a.provider], { retries: 2, sleep })
    await expect(p.generate(req)).rejects.toBe(last)
    // 1 initial round + 2 retries = 3 rounds, with a sleep between rounds only
    expect(a.calls).toHaveLength(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })
})

describe('generateJson', () => {
  const validate = (x: unknown) => {
    if (typeof x === 'object' && x !== null && typeof (x as { n?: unknown }).n === 'number') {
      return x as { n: number }
    }
    throw new Error('shape')
  }

  it('parses JSON wrapped in markdown fences', async () => {
    const a = scripted('a', ['```json\n{"n": 3}\n```'])
    expect(await generateJson(a.provider, req, validate)).toEqual({ n: 3 })
  })

  it('retries once with a repair prompt on invalid JSON, then throws', async () => {
    const a = scripted('a', ['not json', 'still not json'])
    await expect(generateJson(a.provider, req, validate)).rejects.toThrow()
    expect(a.calls).toHaveLength(2)
    expect(a.calls[1].prompt).toContain('not valid JSON')
  })

  it('succeeds when the repair attempt returns valid JSON', async () => {
    const a = scripted('a', ['oops', '{"n": 7}'])
    expect(await generateJson(a.provider, req, validate)).toEqual({ n: 7 })
    expect(a.calls).toHaveLength(2)
  })

  it('propagates provider errors without spending the repair attempt', async () => {
    const boom = new Error('boom')
    const a = scripted('a', [boom])
    await expect(generateJson(a.provider, req, validate)).rejects.toBe(boom)
    expect(a.calls).toHaveLength(1)
  })

  it('rethrows at once when Retry-After exceeds the wait cap instead of sleeping', async () => {
    const hour = 3_600_000
    const a = scripted('a', [new RateLimitError('429', hour)])
    const sleep = vi.fn(async () => {})
    const p = createFallbackProvider([a.provider], { retries: 3, sleep })
    const err = await p.generate(req).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RateLimitError)
    expect((err as RateLimitError).retryAfterMs).toBe(hour)
    expect(sleep).not.toHaveBeenCalled()
    expect(a.calls).toHaveLength(1)
  })

  it('still sleeps for a Retry-After at or under the cap', async () => {
    const a = scripted('a', [new RateLimitError('429', MAX_RETRY_WAIT_MS), 'ok'])
    const sleep = vi.fn(async () => {})
    const p = createFallbackProvider([a.provider], { retries: 3, sleep })
    expect(await p.generate(req)).toEqual({ text: 'ok' })
    expect(sleep).toHaveBeenCalledWith(MAX_RETRY_WAIT_MS)
  })
})
