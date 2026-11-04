import { describe, expect, it } from 'vitest'
import { chunkMessages } from '../../src/pipeline/chunk'
import { reconstructMessages } from '../../src/pipeline/reconstruct'
import { classifyBody } from '../../src/parser/whatsapp'
import type { Message, ParsedChat } from '../../src/shared/types'

const DAY = 86_400_000
const T0 = Date.UTC(2025, 7, 1, 16, 5)

function chatOf(rows: { ts: number; sender: string; text: string; kind?: Message['kind'] }[], participants: string[]): ParsedChat {
  return {
    messages: rows.map((r, id) => ({ id, ts: r.ts, sender: r.sender, text: r.text, kind: r.kind ?? 'text', edited: false })),
    participants,
    systemEvents: [],
    format: 'android',
    dateOrder: 'mdy',
  }
}

describe('reconstructMessages', () => {
  it('round-trips chunkMessages output: senders, text, minute-precision time and kind', () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({
      ts: T0 + Math.floor(i / 30) * DAY + (i % 30) * 60_000,
      sender: i % 3 === 0 ? 'Ana' : 'Ben',
      text: i % 10 === 0 ? '<Media omitted>' : `message ${i} with words`,
      kind: i % 10 === 0 ? ('media' as const) : ('text' as const),
    }))
    const chat = chatOf(rows, ['Ana', 'Ben'])
    const chunks = chunkMessages(chat, 500)
    expect(chunks.length).toBeGreaterThan(1)

    const back = reconstructMessages(chunks, chat.participants)
    expect(back).toHaveLength(rows.length)
    back.forEach((m, i) => {
      expect(m).toMatchObject({ id: i, sender: rows[i].sender, text: rows[i].text, kind: rows[i].kind, edited: false })
      expect(m.ts).toBe(rows[i].ts)
    })
  })

  it('classifies deleted messages with the parser rules', () => {
    expect(classifyBody('This message was deleted')).toBe('deleted')
    expect(classifyBody('  <Media omitted>  ')).toBe('media')
    expect(classifyBody('hello')).toBe('text')
  })

  it('attributes a sender whose name contains ": " to that sender, not a shorter prefix', () => {
    const chunk = {
      index: 0,
      text: '--- 2025-08-01 ---\n09:00 Ana: B: hi there\n09:01 Ana: hello',
    }
    const msgs = reconstructMessages([chunk], ['Ana', 'Ana: B', 'Ben'])
    expect(msgs.map((m) => [m.sender, m.text])).toEqual([
      ['Ana: B', 'hi there'],
      ['Ana', 'hello'],
    ])
  })

  it('a prefix-sharing pair (Ana / Ana: B) picks the longest matching participant', () => {
    const chunk = { index: 0, text: '--- 2025-08-01 ---\n10:00 Ana: B: one\n10:01 Ana: two' }
    const msgs = reconstructMessages([chunk], ['Ana: B', 'Ana'])
    expect(msgs.map((m) => m.sender)).toEqual(['Ana: B', 'Ana'])
    expect(msgs[1].text).toBe('two')
  })

  it('skips lines that match no participant, and lines before any date header', () => {
    const chunk = {
      index: 0,
      text: '09:00 Ana: no header yet\n--- 2025-08-01 ---\n09:05 Stranger: hi\n09:06 Ben: ok',
    }
    const msgs = reconstructMessages([chunk], ['Ana', 'Ben'])
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ sender: 'Ben', text: 'ok', ts: Date.UTC(2025, 7, 1, 9, 6) })
  })

  it('a sender named "__proto__" works', () => {
    const chunk = { index: 0, text: '--- 2025-08-01 ---\n09:00 __proto__: hello' }
    const msgs = reconstructMessages([chunk], ['__proto__', 'Ben'])
    expect(msgs[0].sender).toBe('__proto__')
  })

  it('orders by chunk index and handles empty input', () => {
    const later = { index: 1, text: '--- 2025-08-02 ---\n09:00 Ben: second' }
    const first = { index: 0, text: '--- 2025-08-01 ---\n09:00 Ana: first' }
    expect(reconstructMessages([later, first], ['Ana', 'Ben']).map((m) => m.text)).toEqual(['first', 'second'])
    expect(reconstructMessages([], ['Ana', 'Ben'])).toEqual([])
  })
})
