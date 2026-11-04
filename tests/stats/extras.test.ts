import { describe, expect, it } from 'vitest'
import { computeExtras, STOP_WORDS } from '../../src/stats/extras'
import type { Message, ParsedChat } from '../../src/shared/types'

const at = (m: number, d: number, hh: number, mm: number) => Date.UTC(2025, m - 1, d, hh, mm)

type Row = [m: number, d: number, hh: number, mm: number, sender: string, text: string, kind?: Message['kind']]

function chatOf(rows: Row[]): ParsedChat {
  return {
    messages: rows.map(([m, d, hh, mm, sender, text, kind = 'text'], id) => ({
      id,
      ts: at(m, d, hh, mm),
      sender,
      text,
      kind,
      edited: false,
    })),
    participants: [...new Set(rows.map((r) => r[4]))],
    systemEvents: [],
    format: 'android',
    dateOrder: 'mdy',
  }
}

// Hand-computed fixture (all UTC, 2025).
//  row  date        sender  text
//   0   Jan 30 10:00  Ana   'hello there friend'          (3 words)
//   1   Jan 31 09:00  Ben   'hello hello hello 😂'        (4 tokens)
//   2   Jan 31 09:05  Ana   'haha haha hahaha that was funny' (6 words)
//   3   Feb 1  12:00  Ben   'חחח כל הכבוד חח'              (4 tokens)
//   4   Feb 1  12:01  Ana   <Media omitted>               (media)
//   5   Feb 1  12:02  Ana   'lmao rofl'                   (2 words)
//   6   Feb 4  08:00  Cy    'hi ana 🎉'
//   7   Feb 4  08:01  Cy    'how are you doing today 👍 👍 🎉'
const fixtureRows: Row[] = [
  [1, 30, 10, 0, 'Ana', 'hello there friend'],
  [1, 31, 9, 0, 'Ben', 'hello hello hello 😂'],
  [1, 31, 9, 5, 'Ana', 'haha haha hahaha that was funny'],
  [2, 1, 12, 0, 'Ben', 'חחח כל הכבוד חח'],
  [2, 1, 12, 1, 'Ana', '<Media omitted>', 'media'],
  [2, 1, 12, 2, 'Ana', 'lmao rofl'],
  [2, 4, 8, 0, 'Cy', 'hi ana 🎉'],
  [2, 4, 8, 1, 'Cy', 'how are you doing today 👍 👍 🎉'],
]
const fixture = chatOf(fixtureRows)
const extras = computeExtras(fixture)

describe('computeExtras', () => {
  it('calendar counts every message per UTC day, sorted, only days with messages', () => {
    expect(extras.calendar).toEqual([
      { date: '2025-01-30', count: 1 },
      { date: '2025-01-31', count: 2 },
      { date: '2025-02-01', count: 3 },
      { date: '2025-02-04', count: 2 },
    ])
  })

  it('streak is the longest run of consecutive days with messages, across a month boundary', () => {
    expect(extras.streak).toEqual({ days: 3, fromDate: '2025-01-30', toDate: '2025-02-01' })
  })

  it('longestMessages: top 3 senders by count, each with their longest text message (ties to the earliest)', () => {
    expect(extras.longestMessages).toEqual([
      { sender: 'Ana', words: 6, ts: at(1, 31, 9, 5), text: 'haha haha hahaha that was funny' },
      { sender: 'Ben', words: 4, ts: at(1, 31, 9, 0), text: 'hello hello hello 😂' },
      { sender: 'Cy', words: 8, ts: at(2, 4, 8, 1), text: 'how are you doing today 👍 👍 🎉' },
    ])
  })

  it('caps the longest message text at 600 characters and first/last texts at 200', () => {
    const long = 'word '.repeat(200).trim() // 999 chars, 200 words
    const chat = chatOf([
      [1, 1, 9, 0, 'Ana', long],
      [1, 1, 9, 1, 'Ben', 'x'.repeat(500)],
      [1, 1, 9, 2, 'Ana', 'y'.repeat(300)],
    ])
    const e = computeExtras(chat)
    expect(e.longestMessages[0].text.length).toBe(600)
    expect(e.longestMessages[0].words).toBe(200)
    expect(e.firstMessages[0].text.length).toBe(200)
    expect(e.lastMessages[2].text.length).toBe(200)
  })

  it('firstMessages are the first 5 text messages in order, lastMessages the last 5', () => {
    // text messages in order: rows 0,1,2,3,5,6,7
    expect(extras.firstMessages.map((m) => m.text)).toEqual([
      'hello there friend',
      'hello hello hello 😂',
      'haha haha hahaha that was funny',
      'חחח כל הכבוד חח',
      'lmao rofl',
    ])
    expect(extras.firstMessages[0]).toEqual({ sender: 'Ana', text: 'hello there friend', ts: at(1, 30, 10, 0) })
    // last 5 text messages: rows 2,3,5,6,7
    expect(extras.lastMessages.map((m) => m.sender)).toEqual(['Ana', 'Ben', 'Ana', 'Cy', 'Cy'])
    expect(extras.lastMessages[4].text).toBe('how are you doing today 👍 👍 🎉')
  })

  it('laughs counts laugh tokens (haha, lol, lmao, rofl, Hebrew חח) and 😂 per sender', () => {
    expect(extras.laughs).toEqual({ Ana: 5, Ben: 3 })
    expect(Object.getPrototypeOf(extras.laughs)).toBeNull()
    expect(extras.laughs.Cy).toBeUndefined()
  })

  it('laughRecord is the longest single laugh token by characters, with its sender', () => {
    // 'hahaha' (6 characters) is the longest; ties would go to the earliest
    expect(extras.laughRecord).toEqual({ sender: 'Ana', length: 6 })
  })

  it('topWords: top 5 lowercased letter words >= 3 letters, stop words removed, ties by first appearance', () => {
    expect(extras.topWords).toEqual([
      ['hello', 4],
      ['haha', 2],
      ['friend', 1],
      ['hahaha', 1],
      ['funny', 1],
    ])
  })

  it('stop words are excluded and the set covers English and Hebrew', () => {
    const words = extras.topWords.map(([w]) => w)
    for (const w of ['that', 'was', 'there', 'how', 'are', 'you']) expect(words).not.toContain(w)
    expect(STOP_WORDS).toBeInstanceOf(Set)
    expect(STOP_WORDS.has('the')).toBe(true)
    expect(STOP_WORDS.has('את')).toBe(true)
    expect(STOP_WORDS.size).toBeGreaterThanOrEqual(100)
  })

  it('topEmojis over the whole chat, ties by first appearance', () => {
    // 🎉 x2 (first seen row 6), 👍 x2 (row 7), 😂 x1 (row 1)
    expect(extras.topEmojis).toEqual([
      ['🎉', 2],
      ['👍', 2],
      ['😂', 1],
    ])
  })

  it('a sender named "__proto__" works as a key', () => {
    const chat = chatOf([
      [1, 1, 9, 0, '__proto__', 'haha haha'],
      [1, 1, 9, 1, 'Ben', 'ok ok'],
      [1, 1, 9, 2, '__proto__', 'lol'],
    ])
    const e = computeExtras(chat)
    expect(Object.getOwnPropertyDescriptor(e.laughs, '__proto__')?.value).toBe(3)
    expect(e.laughs['constructor']).toBeUndefined()
    expect(e.longestMessages[0].sender).toBe('__proto__')
    expect(e.laughRecord).toEqual({ sender: '__proto__', length: 4 })
  })

  it('near-empty and empty chats do not throw', () => {
    const one = computeExtras(chatOf([[1, 1, 9, 0, 'Ana', 'hi there']]))
    expect(one.calendar).toEqual([{ date: '2025-01-01', count: 1 }])
    expect(one.streak).toEqual({ days: 1, fromDate: '2025-01-01', toDate: '2025-01-01' })
    expect(one.laughs).toEqual({})

    const empty = computeExtras({ messages: [], participants: [], systemEvents: [], format: 'android', dateOrder: 'mdy' })
    expect(empty.calendar).toEqual([])
    expect(empty.streak).toEqual({ days: 0, fromDate: '', toDate: '' })
    expect(empty.longestMessages).toEqual([])
    expect(empty.firstMessages).toEqual([])
    expect(empty.lastMessages).toEqual([])
    expect(empty.laughRecord).toEqual({ sender: '', length: 0 })
    expect(empty.topWords).toEqual([])
    expect(empty.topEmojis).toEqual([])
  })
})
