import { describe, expect, it } from 'vitest'
import type { Message, ParsedChat } from '../../src/shared/types'
import { applyNameMap, renameParticipant } from '../../web/lib/nameMap'

function chatFrom(senders: string[]): ParsedChat {
  const messages: Message[] = senders.map((sender, id) => ({
    id,
    ts: Date.UTC(2025, 0, 1, 10, id),
    sender,
    text: `message ${id}`,
    kind: 'text',
    edited: false,
  }))
  const participants: string[] = []
  for (const s of senders) if (!participants.includes(s)) participants.push(s)
  return { messages, participants, systemEvents: [], format: 'android', dateOrder: 'mdy' }
}

describe('applyNameMap', () => {
  it('merges two senders into one and keeps first-appearance order', () => {
    const chat = chatFrom(['Ana', 'Ben', 'Ana B', 'Cy', 'Ben'])
    const map = new Map([['Ana B', 'Ana']])

    const out = applyNameMap(chat, map)

    expect(out.participants).toEqual(['Ana', 'Ben', 'Cy'])
    expect(out.messages.map((m) => m.sender)).toEqual(['Ana', 'Ben', 'Ana', 'Cy', 'Ben'])
    expect(out.messages.filter((m) => m.sender === 'Ana')).toHaveLength(2)
  })

  it('moves the merged name to the position of the first appearance', () => {
    const chat = chatFrom(['Cy', 'Ana', 'Ben', 'Ana B'])
    const out = applyNameMap(chat, new Map([['Cy', 'Ana B']]))
    expect(out.participants).toEqual(['Ana B', 'Ana', 'Ben'])
  })

  it('treats "__proto__" and "constructor" as ordinary sender names', () => {
    const chat = chatFrom(['__proto__', 'constructor', 'Ana', '__proto__'])
    const map = new Map([['constructor', 'Ana']])

    const out = applyNameMap(chat, map)

    expect(out.participants).toEqual(['__proto__', 'Ana'])
    expect(out.messages[0].sender).toBe('__proto__')
    expect(out.messages[1].sender).toBe('Ana')
  })

  it('renames a "__proto__" sender without touching the prototype', () => {
    const chat = chatFrom(['__proto__', 'Ben'])
    const out = applyNameMap(chat, new Map([['__proto__', 'Dan']]))
    expect(out.participants).toEqual(['Dan', 'Ben'])
    expect(Object.getPrototypeOf(out.messages)).toBe(Array.prototype)
  })

  it('does not mutate the input chat', () => {
    const chat = chatFrom(['Ana', 'Ben'])
    applyNameMap(chat, new Map([['Ben', 'Ana']]))
    expect(chat.messages.map((m) => m.sender)).toEqual(['Ana', 'Ben'])
    expect(chat.participants).toEqual(['Ana', 'Ben'])
  })
})

describe('renameParticipant', () => {
  it('renames a current name, including people already renamed to it', () => {
    const chat = chatFrom(['Ana', 'Ben', 'Cy'])
    let map = renameParticipant(chat, new Map(), 'Ben', 'Ana')
    map = renameParticipant(chat, map, 'Cy', 'Ana')
    expect(applyNameMap(chat, map).participants).toEqual(['Ana'])
  })
})
