import type { Env } from '../worker/index'
import { GeminiProvider } from './gemini'
import { OpenRouterProvider } from './openrouter'
import { createFallbackProvider, RateLimitError, type LlmProvider } from './provider'

/** One underlying provider attempt, as reported to hooks. Carries no prompt or reply text. */
export interface LlmCallInfo {
  provider: string
  model: string
  ok: boolean
  ms: number
  rateLimited: boolean
}

export interface ProviderHooks {
  onCall?: (info: LlmCallInfo) => void | Promise<void>
}

/**
 * Wraps one provider so every generate() call is reported to onCall. Errors are rethrown unchanged, so
 * RateLimitError checks still work. A failing hook is ignored and never changes the outcome.
 */
export function instrument(p: LlmProvider, hooks: ProviderHooks = {}): LlmProvider {
  return {
    name: p.name,
    model: p.model,
    async generate(req) {
      const started = Date.now()
      let ok = false
      let rateLimited = false
      try {
        const out = await p.generate(req)
        ok = true
        return out
      } catch (err) {
        rateLimited = err instanceof RateLimitError
        throw err
      } finally {
        try {
          await hooks.onCall?.({ provider: p.name, model: p.model ?? '', ok, ms: Date.now() - started, rateLimited })
        } catch {
          // A broken hook must never change the provider's result.
        }
      }
    },
  }
}

/**
 * Verified against https://openrouter.ai/api/v1/models on 2026-11-05: free, 1,048,576-token context, JSON mode.
 * It is a 'stealth' model: prompts may be retained by its provider but are not used for training.
 * Slow (about 7 tokens/s), so OpenRouter calls get the longer timeout.
 */
export const DEFAULT_OPENROUTER_MODEL = 'stealth/crouton-alpha'

/**
 * Gemini models tried in order (checked against the live model list on 2026-11-05). Free-tier models
 * are often overloaded (503) or retired for new users (404, e.g. gemini-2.5-flash), so there is a
 * chain: when one fails the next is tried, and only then does the backoff sleep. Override with the
 * comma-separated GEMINI_MODELS env var.
 */
export const DEFAULT_GEMINI_MODELS = ['gemini-flash-lite-latest', 'gemini-3-flash-preview', 'gemini-3.6-flash']

const MODEL_NAME = /^[a-z0-9][a-z0-9.-]{1,58}$/

function geminiModels(env: Env): string[] {
  const wanted = (env.GEMINI_MODELS ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter((m) => MODEL_NAME.test(m))
  return wanted.length > 0 ? wanted : DEFAULT_GEMINI_MODELS
}

/**
 * Builds the provider chain from env. Gemini is primary unless LLM_PRIMARY is 'openrouter'.
 * Only providers with a key are used. Wrapped in the fallback provider with 3 retry rounds.
 */
export function createProviderFromEnv(env: Env, hooks: ProviderHooks = {}): LlmProvider {
  const gemini = env.GEMINI_API_KEY
    ? geminiModels(env).map((model) => instrument(new GeminiProvider(env.GEMINI_API_KEY as string, model), hooks))
    : []
  const openrouter = env.OPENROUTER_API_KEY
    ? instrument(new OpenRouterProvider(env.OPENROUTER_API_KEY, env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL), hooks)
    : undefined
  const others: LlmProvider[] = openrouter ? [openrouter] : []
  const providers: LlmProvider[] = env.LLM_PRIMARY === 'openrouter' ? [...others, ...gemini] : [...gemini, ...others]
  if (providers.length === 0) throw new Error('no_llm_key_configured')
  return createFallbackProvider(providers, {
    retries: 3,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  })
}
