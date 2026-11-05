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

export const DEFAULT_MAX_CHUNKS = 45

/**
 * Scores a chunk by information and comedic value:
 * - High score for laughter, memes, banter, exclamations, questions, and late-night messages.
 * - High score for chunks where multiple different members participate.
 * - Penalizes chunks dominated by repetitive media omission placeholders or deleted messages.
 */
export function scoreChunk(chunk: Chunk): number {
  let score = 0
  const text = chunk.text

  // 1. Laughter and humor tokens (the heart of group jokes & memes)
  const laughs = (text.match(/חח+|😂|🤣|💀|😭|lol|lmao|מת[הת]?\b/gi) ?? []).length
  score += laughs * 3

  // 2. Questions, banter, exclamations, arguments, spicy keywords
  const banter = (text.match(/\?{1,3}|!{1,3}|למה|מה|די|חלאס|סתום|בחיאת|אורה|כסף|חוב/gi) ?? []).length
  score += banter * 2

  // 3. Dialogue participant diversity: chunks where multiple distinct people talk
  const speakers = new Set(
    (text.match(/^(\d{2}:\d{2})\s+([^:]+):/gm) ?? []).map((l) => l.slice(6, l.indexOf(':'))),
  )
  score += speakers.size * 10

  // 4. Late night banter (hours 23:00 to 04:00 - peak Brandon roast material)
  const lateNight = (text.match(/^(23|00|01|02|03|04):\d{2}\s/gm) ?? []).length
  score += lateNight * 2

  // 5. Penalize chunks that are mostly media omission placeholders or deleted messages
  const mediaOmitted = (text.match(/omitted|מדיה לא נכללה|הודעה זו נמחקה/gi) ?? []).length
  score -= mediaOmitted * 3

  return Math.max(1, score)
}

/**
 * Smart stratified sampling algorithm:
 * - Guarantees inclusion of the first chunk (group inception) and the last chunk (current dynamic).
 * - Divides the entire timeline into equal chronological windows and selects the chunk with the
 *   highest information and comedic banter score in each window.
 * - Preserves strict chronological order and covers the entire timeline with no blind spots.
 */
export function smartSampleChunks(chunks: Chunk[], maxChunks: number): Chunk[] {
  if (chunks.length <= maxChunks || maxChunks <= 0) return chunks

  const chosenIndices = new Set<number>()
  // Always include the very beginning and very end
  chosenIndices.add(0)
  chosenIndices.add(chunks.length - 1)

  // Stratify the remaining chunks into chronological intervals
  const slots = maxChunks - chosenIndices.size
  const step = (chunks.length - 1) / (slots + 1)

  for (let i = 1; i <= slots; i++) {
    const rangeStart = Math.floor((i - 0.5) * step)
    const rangeEnd = Math.min(chunks.length - 1, Math.ceil((i + 0.5) * step))
    let bestIdx = rangeStart
    let bestScore = -1

    for (let j = rangeStart; j <= rangeEnd; j++) {
      if (chosenIndices.has(j)) continue
      const s = scoreChunk(chunks[j])
      if (s > bestScore) {
        bestScore = s
        bestIdx = j
      }
    }
    chosenIndices.add(bestIdx)
  }

  // Sort by chronological order and re-index 0 .. N-1
  return Array.from(chosenIndices)
    .sort((a, b) => a - b)
    .map((origIdx, newIdx) => ({
      ...chunks[origIdx],
      index: newIdx,
    }))
}

/**
 * Splits a chat into model-sized chunks. Lines are "HH:MM Sender: text", with a
 * "--- YYYY-MM-DD ---" header at the start of each chunk and whenever the day changes.
 * A message is never split. A single message longer than maxChars/2 is truncated with an ellipsis.
 * If the resulting chunks exceed maxChunks, intelligent stratified sampling selects the
 * richest, most active banter chunks across the timeline.
 */
export function chunkMessages(
  chat: ParsedChat,
  maxChars: number = DEFAULT_MAX_CHARS,
  maxChunks: number = DEFAULT_MAX_CHUNKS,
): Chunk[] {
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

  if (maxChunks > 0 && chunks.length > maxChunks) {
    return smartSampleChunks(chunks, maxChunks)
  }

  return chunks
}
