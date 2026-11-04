import { describe, expect, it } from 'vitest'
import { chunkMessages } from '../../src/pipeline/chunk'
import type { ParsedChat } from '../../src/shared/types'

const T0 = Date.UTC(2025, 7, 1, 16, 5)
const DAY = 86_400_000

function chatOf(rows: { ts: number; sender: string; text: string }[]): ParsedChat {
  return {
    messages: rows.map((r, id) => ({ id, ts: r.ts, sender: r.sender, text: r.text, kind: 'text', edited: false })),
    participants: ['Ana', 'Ben'],
    systemEvents: [],
    format: 'android',
    dateOrder: 'mdy',
  }
}

describe('chunkMessages', () => {
  const rows = Array.from({ length: 300 }, (_, i) => ({
    ts: T0 + Math.floor(i / 40) * DAY + (i % 40) * 60_000,
    sender: i % 3 === 0 ? 'Ana' : 'Ben',
    text: `message number ${i} with some padding words`,
  }))
  const chat = chatOf(rows)

  it('chunkMessages never splits a message and respects maxChars', () => {
    const chunks = chunkMessages(chat, 1000)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(1000)

    const lines = new Set(chunks.flatMap((c) => c.text.split('\n')))
    for (const r of rows) {
      const d = new Date(r.ts)
      const hh = String(d.getUTCHours()).padStart(2, '0')
      const mm = String(d.getUTCMinutes()).padStart(2, '0')
      expect(lines.has(`${hh}:${mm} ${r.sender}: ${r.text}`)).toBe(true)
    }
  })

  it('chunk ranges are contiguous and cover all messages', () => {
    const chunks = chunkMessages(chat, 1000)
    expect(chunks[0].fromId).toBe(0)
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].index).toBe(i)
      expect(chunks[i].fromId).toBeLessThanOrEqual(chunks[i].toId)
      if (i > 0) expect(chunks[i].fromId).toBe(chunks[i - 1].toId + 1)
    }
    expect(chunks[chunks.length - 1].toId).toBe(rows.length - 1)
  })

  it('writes a date header line when the day changes and formats time in UTC', () => {
    const chunks = chunkMessages(chat)
    const all = chunks.map((c) => c.text).join('\n')
    expect(all).toContain('--- 2025-08-02 ---')
    expect(all).toContain('16:05 Ana: message number 0 with some padding words')
  })

  it('truncates an overlong single message with an ellipsis and keeps it whole in one chunk', () => {
    const big = chatOf([
      { ts: T0, sender: 'Ana', text: 'short' },
      { ts: T0 + 60_000, sender: 'Ben', text: 'x'.repeat(5000) },
      { ts: T0 + 120_000, sender: 'Ana', text: 'after' },
    ])
    const chunks = chunkMessages(big, 1000)
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(1000)
    const all = chunks.map((c) => c.text).join('\n')
    expect(all).toContain('…')
    expect(all).not.toContain('x'.repeat(600))
    expect(all).toContain('after')
    expect(chunks[chunks.length - 1].toId).toBe(2)
  })

  it('returns no chunks for a chat without messages', () => {
    expect(chunkMessages(chatOf([]))).toEqual([])
  })
})
