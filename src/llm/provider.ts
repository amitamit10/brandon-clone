export interface LlmRequest {
  system: string
  prompt: string
  json?: boolean
  maxTokens?: number
}

export interface LlmProvider {
  name: string
  /** Model id, when the provider has one (reported to usage hooks). */
  model?: string
  generate(req: LlmRequest): Promise<{ text: string }>
}

/** Thrown by adapters on HTTP 429. retryAfterMs comes from the Retry-After header when present. */
export class RateLimitError extends Error {
  retryAfterMs?: number
  constructor(message: string, retryAfterMs?: number) {
    super(message)
    this.name = 'RateLimitError'
    this.retryAfterMs = retryAfterMs
  }
}

/** Parses a Retry-After header: delta-seconds or an HTTP-date. Returns undefined if unusable. */
export function parseRetryAfterMs(value: string | null, now: number = Date.now()): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const date = Date.parse(value)
  if (Number.isFinite(date)) return Math.max(0, date - now)
  return undefined
}

const BACKOFF_BASE_MS = 1000
/** Longest we will sleep inside one call. A longer Retry-After is surfaced so the caller can resume later. */
export const MAX_RETRY_WAIT_MS = 30_000
/** Upper bound for a single upstream HTTP call. */
export const LLM_FETCH_TIMEOUT_MS = 60_000
/** For slow free models (about 7 tokens/s: a 1,000-token answer takes over two minutes). */
export const LLM_SLOW_FETCH_TIMEOUT_MS = 180_000

/**
 * Tries providers in order. Any error falls through to the next provider.
 * A round is one pass over all providers. Up to 1 + retries rounds run, with a sleep
 * between rounds: the last RateLimitError's retryAfterMs when given, else exponential
 * backoff (1s, 2s, 4s, ...). When every round fails, the last error object is rethrown
 * unchanged, so callers can test `instanceof RateLimitError`.
 */
export function createFallbackProvider(
  providers: LlmProvider[],
  opts: { retries: number; sleep: (ms: number) => Promise<void> },
): LlmProvider {
  if (providers.length === 0) throw new Error('no providers configured')
  return {
    name: `fallback(${providers.map((p) => p.name).join(',')})`,
    async generate(req) {
      let lastError: unknown
      const rounds = 1 + opts.retries
      for (let round = 0; round < rounds; round++) {
        for (const provider of providers) {
          try {
            return await provider.generate(req)
          } catch (e) {
            lastError = e
          }
        }
        if (round < rounds - 1) {
          const hinted = lastError instanceof RateLimitError ? lastError.retryAfterMs : undefined
          if (hinted !== undefined && hinted > MAX_RETRY_WAIT_MS) throw lastError
          await opts.sleep(hinted ?? BACKOFF_BASE_MS * 2 ** round)
        }
      }
      throw lastError
    },
  }
}

/** Strips markdown code fences that free models often wrap JSON in. */
function parseJsonText(text: string): unknown {
  const body = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  return JSON.parse(body)
}

const REPAIR_NOTE =
  'Your previous reply was not valid JSON for the required shape. Reply with only the JSON value, no prose and no code fences.'

/**
 * Generates JSON and validates it. One repair retry if the reply does not parse or fails
 * validation. Errors from generate() (including fallback exhaustion) propagate at once
 * and do not use up the repair attempt.
 */
export async function generateJson<T>(
  p: LlmProvider,
  req: LlmRequest,
  validate: (x: unknown) => T,
): Promise<T> {
  const first = await p.generate({ ...req, json: true })
  try {
    return validate(parseJsonText(first.text))
  } catch {
    // fall through to the repair attempt
  }
  const second = await p.generate({ ...req, json: true, prompt: `${req.prompt}\n\n${REPAIR_NOTE}` })
  try {
    return validate(parseJsonText(second.text))
  } catch {
    throw new Error('llm_invalid_json')
  }
}
