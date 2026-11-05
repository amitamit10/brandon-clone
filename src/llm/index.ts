import type { Env } from '../worker/index'
import { GeminiProvider } from './gemini'
import { OpenRouterProvider } from './openrouter'
import { createFallbackProvider, type LlmProvider } from './provider'

/**
 * Verified against https://openrouter.ai/api/v1/models on 2026-11-05: free, 1,048,576-token context, JSON mode.
 * It is a 'stealth' model: prompts may be retained by its provider but are not used for training.
 * Slow (about 7 tokens/s), so OpenRouter calls get the longer timeout.
 */
export const DEFAULT_OPENROUTER_MODEL = 'stealth/crouton-alpha'

/** Free OpenRouter models, tried in order (both 1M-token context, JSON mode; checked 2026-11-05). */
export const DEFAULT_OPENROUTER_MODELS = [DEFAULT_OPENROUTER_MODEL, 'nvidia/nemotron-3.5-super-vl:free']

function openrouterModels(env: Env): string[] {
  if (env.OPENROUTER_MODEL) return [env.OPENROUTER_MODEL] // single-model override
  const wanted = (env.OPENROUTER_MODELS ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter((m) => /^[a-z0-9][a-z0-9._:/-]{2,80}$/i.test(m))
  return wanted.length > 0 ? wanted : DEFAULT_OPENROUTER_MODELS
}

/**
 * Gemini models tried in order (checked against the live model list on 2026-11-05). Free-tier models
 * are often overloaded (503) or retired for new users (404, e.g. gemini-2.5-flash), so there is a
 * chain: when one fails the next is tried, and only then does the backoff sleep. Override with the
 * comma-separated GEMINI_MODELS env var.
 */
export const DEFAULT_GEMINI_MODELS = ['gemini-flash-lite-latest', 'gemini-3-flash-preview', 'gemini-3.6-flash']

/**
 * The final report needs the stronger models first (the lite model gave thin or invalid reports on the
 * real 14k-message test chat, 2026-11-05); lite is only the last resort.
 */
export const REPORT_GEMINI_MODELS = ['gemini-3-flash-preview', 'gemini-3.6-flash', 'gemini-flash-lite-latest']

export type LlmPurpose = 'summary' | 'report'

const MODEL_NAME = /^[a-z0-9][a-z0-9.-]{1,58}$/

function geminiModels(env: Env, purpose: LlmPurpose): string[] {
  const wanted = (env.GEMINI_MODELS ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter((m) => MODEL_NAME.test(m))
  return wanted.length > 0 ? wanted : purpose === 'report' ? REPORT_GEMINI_MODELS : DEFAULT_GEMINI_MODELS
}

/**
 * Builds the provider chain from env. Gemini is primary unless LLM_PRIMARY is 'openrouter'.
 * Only providers with a key are used. Wrapped in the fallback provider with 3 retry rounds.
 */
export function createProviderFromEnv(env: Env, purpose: LlmPurpose = 'summary'): LlmProvider {
  const gemini = env.GEMINI_API_KEY
    ? geminiModels(env, purpose).map((model) => new GeminiProvider(env.GEMINI_API_KEY as string, model))
    : []
  const openrouter: LlmProvider[] = env.OPENROUTER_API_KEY
    ? openrouterModels(env).map((model) => new OpenRouterProvider(env.OPENROUTER_API_KEY as string, model))
    : []
  const providers: LlmProvider[] = env.LLM_PRIMARY === 'openrouter' ? [...openrouter, ...gemini] : [...gemini, ...openrouter]
  if (providers.length === 0) throw new Error('no_llm_key_configured')
  return createFallbackProvider(providers, {
    retries: 3,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  })
}
