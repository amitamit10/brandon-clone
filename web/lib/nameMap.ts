import type { ParsedChat } from '../../src/shared/types'

/**
 * Renames senders. Two senders that end up with the same name are merged into one.
 * Participants come out unique, in first-appearance order. Maps are used throughout,
 * so sender names such as "__proto__" or "constructor" are plain keys.
 */
export function applyNameMap(chat: ParsedChat, map: Map<string, string>): ParsedChat {
  const messages = chat.messages.map((m) => {
    const sender = map.get(m.sender) ?? m.sender
    return sender === m.sender ? m : { ...m, sender }
  })
  const seen = new Set<string>()
  const participants: string[] = []
  for (const m of messages) {
    if (!seen.has(m.sender)) {
      seen.add(m.sender)
      participants.push(m.sender)
    }
  }
  return { ...chat, messages, participants }
}

/**
 * Returns a new map where every original sender whose current name is `from` now
 * reads `to`. Used for both renames and merges (merge = rename to the same name).
 */
export function renameParticipant(
  chat: ParsedChat,
  map: Map<string, string>,
  from: string,
  to: string,
): Map<string, string> {
  const next = new Map(map)
  for (const original of chat.participants) {
    const current = next.get(original) ?? original
    if (current === from) next.set(original, to)
  }
  return next
}
