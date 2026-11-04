import type { ParsedChat } from '../../src/shared/types'

// Hand-built chat with known answers (all times UTC, year 2025).
// Ana = A, Ben = B, Cy = C.
const at = (day: number, hh: number, mm: number) => Date.UTC(2025, 7, day, hh, mm) // August

type Row = [day: number, hh: number, mm: number, sender: string, text: string, kind?: 'text' | 'media' | 'deleted', edited?: boolean]

const rows: Row[] = [
  [1, 9, 0, 'Ana', 'good morning all'],
  [1, 9, 5, 'Ben', 'hey ☀️ there'],
  [1, 9, 6, 'Ana', '<Media omitted>', 'media'],
  [1, 9, 7, 'Ben', 'This message was deleted', 'deleted'],
  [1, 16, 0, 'Cy', 'back 👍🏽 👨‍👩‍👧 👍🏽'],
  [1, 16, 30, 'Ana', 'wow', 'text', true],
  [1, 16, 31, 'Ana', 'still here'],
  [1, 16, 40, 'Ben', 'lol'],
  [2, 10, 0, 'Cy', 'ok 👍🏽'],
  [2, 10, 2, 'Ana', 'ok ok ok'],
]

export const statsChat: ParsedChat = {
  messages: rows.map(([d, h, m, sender, text, kind = 'text', edited = false], id) => ({
    id,
    ts: at(d, h, m),
    sender,
    text,
    kind,
    edited,
  })),
  participants: ['Ana', 'Ben', 'Cy'],
  systemEvents: [],
  format: 'android',
  dateOrder: 'mdy',
}

/** Weekly chat: counts[w] messages on the Monday of week w (weeks start 2025-06-02, UTC). */
export function weeklyChat(counts: number[]): ParsedChat {
  const messages: ParsedChat['messages'] = []
  const monday = Date.UTC(2025, 5, 2)
  counts.forEach((count, w) => {
    for (let i = 0; i < count; i++) {
      messages.push({
        id: messages.length,
        ts: monday + w * 7 * 86_400_000 + 12 * 3_600_000 + i * 60_000,
        sender: i % 2 === 0 ? 'Ana' : 'Ben',
        text: 'x',
        kind: 'text',
        edited: false,
      })
    }
  })
  return { messages, participants: ['Ana', 'Ben'], systemEvents: [], format: 'android', dateOrder: 'mdy' }
}

/** n messages alternating between the given senders, one per minute, text 'hello there'. */
export function manyChat(n: number, senders: string[]): ParsedChat {
  const base = Date.UTC(2025, 7, 1, 9, 0)
  return {
    messages: Array.from({ length: n }, (_, id) => ({
      id,
      ts: base + id * 60_000,
      sender: senders[id % senders.length],
      text: 'hello there',
      kind: 'text' as const,
      edited: false,
    })),
    participants: [...new Set(senders)],
    systemEvents: [],
    format: 'android',
    dateOrder: 'mdy',
  }
}
