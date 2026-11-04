import { describe, expect, it } from 'vitest'
import { summarizeChunk } from '../../src/pipeline/summarize'
import type { LlmProvider, LlmRequest } from '../../src/llm/provider'
import type { Chunk } from '../../src/shared/types'

const chunk: Chunk = { index: 3, fromId: 10, toId: 12, text: '--- 2025-08-01 ---\n09:00 Ana: hello\n' }

function fake(reply: string) {
  const calls: LlmRequest[] = []
  const p: LlmProvider = {
    name: 'fake',
    async generate(req) {
      calls.push(req)
      return { text: reply }
    },
  }
  return { p, calls }
}

describe('summarizeChunk', () => {
  it('summarizeChunk validates the JSON shape and rejects missing fields', async () => {
    const { p } = fake(JSON.stringify({ events: ['a'] }))
    await expect(summarizeChunk(p, chunk, 'English')).rejects.toThrow('llm_invalid_json')
  })

  it('returns the chunk index and caps quotes at 8 entries of 300 chars', async () => {
    const quotes = Array.from({ length: 10 }, () => 'q'.repeat(400))
    const { p } = fake(JSON.stringify({ events: ['e'], jokes: ['j'], memberNotes: { Ana: 'n' }, quotes }))
    const s = await summarizeChunk(p, chunk, 'English')
    expect(s.index).toBe(3)
    expect(s.quotes).toHaveLength(8)
    for (const q of s.quotes) expect(q.length).toBeLessThanOrEqual(300)
    expect(s.memberNotes.Ana).toBe('n')
  })

  it('keeps memberNotes free of prototype keys such as __proto__ and constructor', async () => {
    const raw = '{"events":[],"jokes":[],"memberNotes":{"__proto__":"x","constructor":"y"},"quotes":[]}'
    const { p } = fake(raw)
    const s = await summarizeChunk(p, chunk, 'English')
    expect(Object.getPrototypeOf(s.memberNotes)).toBeNull()
    expect(s.memberNotes.constructor).toBe('y')
  })

  it('passes the summary language through to the model', async () => {
    const { p, calls } = fake(JSON.stringify({ events: [], jokes: [], memberNotes: {}, quotes: [] }))
    await summarizeChunk(p, chunk, 'Hebrew')
    expect(calls[0].prompt).toContain('Hebrew')
  })
})
