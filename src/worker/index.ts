import { Hono } from 'hono'

export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  GEMINI_API_KEY?: string
  OPENROUTER_API_KEY?: string
  OPENROUTER_MODEL?: string
  LLM_PRIMARY?: 'gemini' | 'openrouter'
}

const app = new Hono<{ Bindings: Env }>()

app.get('/api/health', (c) => c.json({ ok: true }))

export default app
