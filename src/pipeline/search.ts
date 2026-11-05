/**
 * BM25 retrieval over stored chunks, for follow-up questions. Pure and linear-time: the patterns are
 * single-token scans, and the query is capped, so a hostile question or chat cannot blow up the CPU.
 *
 * Tokens: lowercase runs of letters or digits (Hebrew and any other script included, no stemming), plus
 * each emoji. Word tokens shorter than 2 characters are skipped; emoji are always kept.
 */

import { emojiGraphemes } from '../stats/emoji'

const K1 = 1.5
const B = 0.75
const MAX_QUERY_TOKENS = 30

const WORD = /\p{L}+|\p{N}+/gu

/** Word tokens (length 2 or more) plus emoji graphemes, so a skin tone or ZWJ family counts as one token. */
export function tokenize(text: string): string[] {
  const out: string[] = []
  for (const m of text.toLowerCase().matchAll(WORD)) {
    if (m[0].length >= 2) out.push(m[0])
  }
  for (const e of emojiGraphemes(text)) out.push(e)
  return out
}

interface Doc {
  idx: number
  text: string
  length: number
  tf: Map<string, number>
}

/**
 * Ranks chunks against the query and returns at most k with a score above 0, best first. Ties go to
 * the lower idx. Empty chunks, an empty or blank query, or k below 1 give [].
 */
export function searchChunks(
  chunks: { idx: number; text: string }[],
  query: string,
  k: number,
): { idx: number; text: string; score: number }[] {
  if (chunks.length === 0 || !(k >= 1)) return []
  const terms = [...new Set(tokenize(query).slice(0, MAX_QUERY_TOKENS))]
  if (terms.length === 0) return []

  const docs: Doc[] = chunks.map((c) => {
    const tokens = tokenize(c.text)
    const tf = new Map<string, number>()
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
    return { idx: c.idx, text: c.text, length: tokens.length, tf }
  })

  const totalLength = docs.reduce((sum, d) => sum + d.length, 0)
  if (totalLength === 0) return []
  const avgLength = totalLength / docs.length

  const n = docs.length
  const idf = new Map<string, number>()
  for (const term of terms) {
    let df = 0
    for (const d of docs) if (d.tf.has(term)) df++
    idf.set(term, Math.log(1 + (n - df + 0.5) / (df + 0.5)))
  }

  const scored: { idx: number; text: string; score: number }[] = []
  for (const d of docs) {
    const norm = K1 * (1 - B + (B * d.length) / avgLength)
    let score = 0
    for (const term of terms) {
      const f = d.tf.get(term)
      if (f === undefined) continue
      score += (idf.get(term) ?? 0) * ((f * (K1 + 1)) / (f + norm))
    }
    if (score > 0) scored.push({ idx: d.idx, text: d.text, score })
  }

  scored.sort((a, b) => b.score - a.score || a.idx - b.idx)
  return scored.slice(0, Math.floor(k))
}
