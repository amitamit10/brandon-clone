import { parseRetryAfterMs, RateLimitError, type LlmProvider, type LlmRequest } from './provider'

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

export class OpenRouterProvider implements LlmProvider {
  name = 'openrouter'
  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  async generate(req: LlmRequest): Promise<{ text: string }> {
    const res = await globalThis.fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.prompt },
        ],
        ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
        ...(req.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    })
    if (res.status === 429) {
      throw new RateLimitError('openrouter rate limited', parseRetryAfterMs(res.headers.get('retry-after')))
    }
    if (!res.ok) throw new Error(`openrouter http ${res.status}`)
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const text = data.choices?.[0]?.message?.content ?? ''
    if (!text) throw new Error('openrouter empty response')
    return { text }
  }
}
