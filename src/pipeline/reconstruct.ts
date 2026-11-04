import { classifyBody } from '../parser/whatsapp'
import type { Message } from '../shared/types'

const DAY_HEADER = /^--- (\d{4}-\d{2}-\d{2}) ---$/
const CLOCK = /^\d{2}:\d{2} /

/**
 * Rebuilds messages from stored chunk text, the format chunkMessages writes: a "--- YYYY-MM-DD ---"
 * header, then "HH:MM Sender: text" lines. Chunk text came from the browser, so it is untrusted:
 * linear string work only, and lines that do not match are skipped.
 * A sender name can contain ': ', so a line is attributed to the LONGEST participant whose name is
 * followed by ': '. Edited suffixes are not stored in chunks, so edited is always false.
 */
export function reconstructMessages(chunks: { index: number; text: string }[], participants: string[]): Message[] {
  const names = [...new Set(participants)].filter((p) => p.length > 0).sort((a, b) => b.length - a.length)
  const messages: Message[] = []
  let day: number | null = null // UTC ms at midnight of the current day

  for (const chunk of [...chunks].sort((a, b) => a.index - b.index)) {
    for (const line of chunk.text.split('\n')) {
      const header = DAY_HEADER.exec(line)
      if (header) {
        const base = Date.parse(`${header[1]}T00:00:00Z`)
        day = Number.isFinite(base) ? base : null
        continue
      }
      if (day === null || !CLOCK.test(line)) continue
      const hh = Number(line.slice(0, 2))
      const mm = Number(line.slice(3, 5))
      if (hh > 23 || mm > 59) continue

      const rest = line.slice(6)
      const sender = names.find((name) => rest.startsWith(`${name}: `))
      if (sender === undefined) continue
      const text = rest.slice(sender.length + 2)
      messages.push({
        id: messages.length,
        ts: day + (hh * 60 + mm) * 60_000,
        sender,
        text,
        kind: classifyBody(text),
        edited: false,
      })
    }
  }
  return messages
}
