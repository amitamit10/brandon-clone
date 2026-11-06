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
 * How strongly sampling favours recent chunks. 0 = uniform over the timeline, 1 = the densest
 * (quadratic) recency curve. At 0.6 the newest stretch gets about 2.5x the sampling density of
 * the average and the oldest stretch about 0.6x, so old history is thinner but still covered.
 */
export const RECENCY_BIAS = 0.6

/** Maps a uniform position t in [0,1] to a timeline position, bunching samples toward the end. */
const warp = (t: number) => (1 - RECENCY_BIAS) * t + RECENCY_BIAS * (1 - (1 - t) ** 2)

/**
 * Recency-weighted stratified sampling:
 * - Always includes the first chunk (group inception) and the last chunk (current dynamic).
 * - Places the remaining slots along a curve that is denser toward the present, so recent
 *   conversation gets more chunks while the old timeline is still represented (no blind spots).
 * - In each slot's window, picks the chunk with the highest banter score.
 * - Preserves chronological order and re-indexes 0 .. N-1.
 */
export function smartSampleChunks(chunks: Chunk[], maxChunks: number): Chunk[] {
  if (chunks.length <= maxChunks || maxChunks <= 0) return chunks

  const last = chunks.length - 1
  const chosenIndices = new Set<number>([0, last])
  const slots = maxChunks - chosenIndices.size

  // Slot centres along the warped timeline, with window borders at the midpoints between them.
  const centres: number[] = [0]
  for (let i = 1; i <= slots; i++) centres.push(warp(i / (slots + 1)) * last)
  centres.push(last)

  for (let i = 1; i <= slots; i++) {
    const rangeStart = Math.max(0, Math.ceil((centres[i - 1] + centres[i]) / 2))
    const rangeEnd = Math.min(last, Math.floor((centres[i] + centres[i + 1]) / 2))
    let bestIdx = -1
    let bestScore = -1
    for (let j = rangeStart; j <= rangeEnd; j++) {
      if (chosenIndices.has(j)) continue
      const s = scoreChunk(chunks[j])
      if (s > bestScore) {
        bestScore = s
        bestIdx = j
      }
    }
    if (bestIdx === -1) {
      // Window fully taken (dense recent region): fall back to the nearest unchosen chunk.
      for (let d = 1; d <= last && bestIdx === -1; d++) {
        const c = Math.round(centres[i])
        if (c - d >= 0 && !chosenIndices.has(c - d)) bestIdx = c - d
        else if (c + d <= last && !chosenIndices.has(c + d)) bestIdx = c + d
      }
    }
    if (bestIdx !== -1) chosenIndices.add(bestIdx)
  }

  return Array.from(chosenIndices)
    .sort((a, b) => a - b)
    .map((origIdx, newIdx) => ({ ...chunks[origIdx], index: newIdx }))
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
