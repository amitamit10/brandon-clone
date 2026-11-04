import type { Chunk, ParsedChat } from '../shared/types'

const DEFAULT_MAX_CHARS = 24_000
const pad = (n: number) => String(n).padStart(2, '0')
/** ISO day of the UTC wall-clock time (message ts is wall-clock expressed as UTC ms). */
const isoDay = (ts: number) => new Date(ts).toISOString().slice(0, 10)
const hm = (ts: number) => {
  const d = new Date(ts)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
/** Collapses all whitespace (including newlines) so a message is always one line. */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

/**
 * Splits a chat into model-sized chunks. Lines are "HH:MM Sender: text", with a
 * "--- YYYY-MM-DD ---" header at the start of each chunk and whenever the day changes.
 * A message is never split. A single message longer than maxChars/2 is truncated with an ellipsis.
 */
export function chunkMessages(chat: ParsedChat, maxChars: number = DEFAULT_MAX_CHARS): Chunk[] {
  const chunks: Chunk[] = []
  const cap = Math.floor(maxChars / 2)

  let lines: string[] = []
  let length = 0
  let day: string | null = null
  let fromId = 0
  let toId = 0

  const flush = () => {
    if (lines.length === 0) return
    chunks.push({ index: chunks.length, fromId, toId, text: lines.join('\n') })
    lines = []
    length = 0
    day = null
  }

  for (const m of chat.messages) {
    const d = isoDay(m.ts)
    let line = `${hm(m.ts)} ${m.sender}: ${oneLine(m.text)}`
    if (line.length > cap) line = `${line.slice(0, cap - 1)}…`

    const pieces = day === d ? [line] : [`--- ${d} ---`, line]
    const extra = pieces.reduce((n, p) => n + p.length + 1, 0)
    if (lines.length > 0 && length + extra > maxChars) flush()

    const toAdd = day === d ? [line] : [`--- ${d} ---`, line]
    if (lines.length === 0) fromId = m.id
    for (const p of toAdd) {
      length += (lines.length > 0 ? 1 : 0) + p.length
      lines.push(p)
    }
    day = d
    toId = m.id
  }
  flush()
  return chunks
}
