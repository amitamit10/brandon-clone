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
 * Verified against https://openrouter.ai/api/v1/models on 2026-11-05: free, 1M-token context, JSON mode.
 * NVIDIA Nemotron 3.5 provides high throughput (~2,000-6,000 tokens/s) via hybrid Mamba-Transformer MoE.
 */
export const DEFAULT_OPENROUTER_MODEL = 'nvidia/nemotron-3.5-super-vl:free'

/** Free OpenRouter models, tried in order (1M-token context, JSON mode; checked 2026-11-05). */
export const DEFAULT_OPENROUTER_MODELS = [
  DEFAULT_OPENROUTER_MODEL,
  'nvidia/nemotron-3.5-lightning:free',
  'stealth/crouton-alpha',
]

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
export interface CreateProviderOptions {
  purpose?: LlmPurpose
  hooks?: ProviderHooks
}

export function createProviderFromEnv(
  env: Env,
  optsOrPurpose?: LlmPurpose | CreateProviderOptions | ProviderHooks,
): LlmProvider {
  let purpose: LlmPurpose = 'summary'
  let hooks: ProviderHooks = {}
  if (typeof optsOrPurpose === 'string') {
    purpose = optsOrPurpose
  } else if (optsOrPurpose && typeof optsOrPurpose === 'object') {
    if ('onCall' in optsOrPurpose) {
      hooks = optsOrPurpose as ProviderHooks
    } else {
      if ('purpose' in optsOrPurpose && optsOrPurpose.purpose) purpose = optsOrPurpose.purpose
      if ('hooks' in optsOrPurpose && optsOrPurpose.hooks) hooks = optsOrPurpose.hooks
    }
  }

  const gemini = env.GEMINI_API_KEY
    ? geminiModels(env, purpose).map((model) => instrument(new GeminiProvider(env.GEMINI_API_KEY as string, model), hooks))
    : []
  const openrouter: LlmProvider[] = env.OPENROUTER_API_KEY
    ? openrouterModels(env).map((model) => instrument(new OpenRouterProvider(env.OPENROUTER_API_KEY as string, model), hooks))
    : []
  const providers: LlmProvider[] = env.LLM_PRIMARY === 'openrouter' ? [...openrouter, ...gemini] : [...gemini, ...openrouter]
  if (providers.length === 0) throw new Error('no_llm_key_configured')
  return createFallbackProvider(providers, {
    retries: 3,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  })
}
