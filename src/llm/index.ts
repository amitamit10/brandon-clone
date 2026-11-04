import type { Env } from '../worker/index'
import { GeminiProvider } from './gemini'
import { OpenRouterProvider } from './openrouter'
import { createFallbackProvider, type LlmProvider } from './provider'

/** Verified against https://openrouter.ai/api/v1/models on 2026-11-05 (a `:free` model). */
export const DEFAULT_OPENROUTER_MODEL = 'google/gemma-4-31b-it:free'

/**
 * Builds the provider chain from env. Gemini is primary unless LLM_PRIMARY is 'openrouter'.
 * Only providers with a key are used. Wrapped in the fallback provider with 3 retry rounds.
 */
export function createProviderFromEnv(env: Env): LlmProvider {
  const gemini = env.GEMINI_API_KEY ? new GeminiProvider(env.GEMINI_API_KEY) : undefined
  const openrouter = env.OPENROUTER_API_KEY
    ? new OpenRouterProvider(env.OPENROUTER_API_KEY, env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL)
    : undefined
  const ordered: (LlmProvider | undefined)[] = env.LLM_PRIMARY === 'openrouter' ? [openrouter, gemini] : [gemini, openrouter]
  const providers = ordered.filter((p): p is LlmProvider => p !== undefined)
  if (providers.length === 0) throw new Error('no_llm_key_configured')
  return createFallbackProvider(providers, {
    retries: 3,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  })
}
