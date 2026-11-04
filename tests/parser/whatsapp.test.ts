import { describe, expect, it } from 'vitest'
import { parseExport } from '../../src/parser/whatsapp'
import { ParseError } from '../../src/shared/types'

const utc = (y: number, mo: number, d: number, h: number, mi: number, s = 0) => Date.UTC(y, mo - 1, d, h, mi, s)

describe('parseExport', () => {
  it('parses android MDY 24h', () => {
    const c = parseExport('8/28/25, 23:29 - Name: hi\n')
    expect(c.format).toBe('android')
    expect(c.dateOrder).toBe('mdy')
    expect(c.messages).toHaveLength(1)
    expect(c.messages[0]).toMatchObject({ id: 0, ts: utc(2025, 8, 28, 23, 29), sender: 'Name', text: 'hi', kind: 'text', edited: false })
    expect(c.participants).toEqual(['Name'])
  })

  it('parses ios DMY with seconds', () => {
    const c = parseExport('[28/08/2025, 23:29:05] Name: hi\n')
    expect(c.format).toBe('ios')
    expect(c.dateOrder).toBe('dmy')
    expect(c.messages[0]).toMatchObject({ ts: utc(2025, 8, 28, 23, 29, 5), sender: 'Name', text: 'hi' })
  })

  it('detects dmy when any first number is >12', () => {
    const c = parseExport('3/4/25, 10:00 - A: x\n25/4/25, 10:00 - A: y\n')
    expect(c.dateOrder).toBe('dmy')
    expect(c.messages[0].ts).toBe(utc(2025, 4, 3, 10, 0))
  })

  it('detects mdy when any second number is >12', () => {
    const c = parseExport('3/4/25, 10:00 - A: x\n4/25/25, 10:00 - A: y\n')
    expect(c.dateOrder).toBe('mdy')
    expect(c.messages[0].ts).toBe(utc(2025, 3, 4, 10, 0))
  })

  it('joins multi-line messages with newlines', () => {
    const c = parseExport('8/28/25, 23:29 - A: line one\nline two\nline three\n8/28/25, 23:30 - B: next\n')
    expect(c.messages).toHaveLength(2)
    expect(c.messages[0].text).toBe('line one\nline two\nline three')
  })

  it('treats a timestamp-shaped continuation line as text unless it matches the full header', () => {
    const c = parseExport('8/28/25, 23:29 - A: remember\n8/28/25 was the day\n8/28/25, 23:30 - B: ok\n')
    expect(c.messages).toHaveLength(2)
    expect(c.messages[0].text).toBe('remember\n8/28/25 was the day')
  })

  it('strips bidi marks and keeps emoji in sender names', () => {
    const c = parseExport('8/28/25, 23:29 - ‎‫הראל‬‎ added you\n8/28/25, 23:30 - גוטמן \u{1F410}: ‫shalom‬\n')
    expect(c.messages[0].sender).toBe('גוטמן \u{1F410}')
    expect(c.messages[0].text).toBe('shalom')
    expect(c.systemEvents[0].text).toBe('הראל added you')
  })

  it("keeps ': ' inside the message text", () => {
    const c = parseExport('8/28/25, 23:29 - A: note: this is: fine\n')
    expect(c.messages[0].sender).toBe('A')
    expect(c.messages[0].text).toBe('note: this is: fine')
  })

  it('classifies media, deleted and edited messages', () => {
    const c = parseExport(
      [
        '8/28/25, 23:29 - A: <Media omitted>',
        '8/28/25, 23:30 - A: This message was deleted',
        '8/28/25, 23:31 - B: You deleted this message',
        '8/28/25, 23:32 - B: fixed typo <This message was edited>',
      ].join('\n'),
    )
    expect(c.messages.map((m) => m.kind)).toEqual(['media', 'deleted', 'deleted', 'text'])
    expect(c.messages[3]).toMatchObject({ text: 'fixed typo', edited: true })
  })

  it('puts system lines in systemEvents, not messages', () => {
    const c = parseExport('8/28/25, 23:29 - Messages and calls are end-to-end encrypted.\n8/28/25, 23:30 - A: hi\n')
    expect(c.messages).toHaveLength(1)
    expect(c.systemEvents).toEqual([{ ts: utc(2025, 8, 28, 23, 29), text: 'Messages and calls are end-to-end encrypted.' }])
  })

  it('parses 12h AM/PM clocks', () => {
    const c = parseExport('8/28/25, 11:05 PM - A: x\n8/29/25, 12:10 AM - A: y\n8/29/25, 12:30 PM - A: z\n')
    expect(c.messages.map((m) => m.ts)).toEqual([utc(2025, 8, 28, 23, 5), utc(2025, 8, 29, 0, 10), utc(2025, 8, 29, 12, 30)])
  })

  it('throws ParseError no_messages on empty or non-chat text', () => {
    for (const t of ['', 'hello world\nnot a chat']) {
      try {
        parseExport(t)
        throw new Error('should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(ParseError)
        expect((e as ParseError).code).toBe('no_messages')
      }
    }
  })

  it('stays linear on pathological whitespace (no regex backtracking)', () => {
    const t0 = Date.now()
    const c = parseExport('8/28/25, 23:29 - A: x' + ' '.repeat(200_000) + 'y\n8/28/25, 23:30 - B: z' + '\n'.repeat(200_000) + 'w\n')
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(c.messages).toHaveLength(2)
    expect(c.messages[1].text.startsWith('z')).toBe(true)
  })

  it('does not treat a mid-text edited marker as an edit and still strips a trailing one with spaces', () => {
    const c = parseExport('8/28/25, 23:29 - A: <This message was edited> not at end\n8/28/25, 23:30 - A: hello   <This message was edited>  \n')
    expect(c.messages[0]).toMatchObject({ text: '<This message was edited> not at end', edited: false })
    expect(c.messages[1]).toMatchObject({ text: 'hello', edited: true })
  })
})
