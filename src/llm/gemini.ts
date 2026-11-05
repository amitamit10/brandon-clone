import { LLM_FETCH_TIMEOUT_MS, parseRetryAfterMs, RateLimitError, type LlmProvider, type LlmRequest } from './provider'

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

export class GeminiProvider implements LlmProvider {
  name = 'gemini'
  constructor(
    private apiKey: string,
    public model = 'gemini-2.5-flash',
  ) {}

  async generate(req: LlmRequest): Promise<{ text: string }> {
    // The key goes in a header only. Errors never include the URL, headers or body.
    const res = await globalThis.fetch(`${ENDPOINT}/${this.model}:generateContent`, {
      method: 'POST',
      signal: req.signal ? AbortSignal.any([AbortSignal.timeout(LLM_FETCH_TIMEOUT_MS), req.signal]) : AbortSignal.timeout(LLM_FETCH_TIMEOUT_MS),
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
        generationConfig: {
          ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}),
          ...(req.json ? { responseMimeType: 'application/json' } : {}),
        },
      }),
    })
    if (res.status === 429) {
      throw new RateLimitError('gemini rate limited', parseRetryAfterMs(res.headers.get('retry-after')))
    }
    if (!res.ok) throw new Error(`gemini http ${res.status}`)
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    if (!text) throw new Error('gemini empty response')
    return { text }
  }
}
