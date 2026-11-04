// Shared by compute.ts (per-member emoji) and extras.ts (laughs, top emojis).
const graphemes = new Intl.Segmenter('und', { granularity: 'grapheme' })
const PICTO = /\p{Extended_Pictographic}/u

/** Emoji graphemes in a string (multi-codepoint emoji count once). */
export function emojiGraphemes(text: string): string[] {
  const out: string[] = []
  for (const { segment } of graphemes.segment(text)) {
    if (PICTO.test(segment)) out.push(segment)
  }
  return out
}
