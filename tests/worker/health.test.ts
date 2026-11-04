import { exports } from 'cloudflare:workers'
import { expect, it } from 'vitest'

it('GET /api/health returns {ok:true}', async () => {
  const res = await (exports as unknown as { default: Fetcher }).default.fetch('http://example.com/api/health')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
})
