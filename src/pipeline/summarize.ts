import { generateJson, type LlmProvider } from '../llm/provider'
import type { Chunk, ChunkSummary } from '../shared/types'
import { DATA_RULE, fence, safeLanguage } from './safety'

const SUMMARY_SYSTEM = [
  'You summarise one slice of a WhatsApp group chat so that a later report can use the summary.',
  'Reply with ONLY one JSON object of this shape: {"events": string[], "jokes": string[], "memberNotes": {"<sender name>": string}, "quotes": string[]}.',
  'events: what happened, in short factual sentences. jokes: running jokes or bits. memberNotes: one short note per sender who speaks in this slice.',
  'quotes: up to 8 short lines copied VERBATIM from the chat text, the funniest or most revealing ones. Never paraphrase a quote.',
  'Write the notes in the requested language. No prose outside the JSON and no code fences.',
  DATA_RULE,
].join('\n')

const MAX_EVENTS = 50
const MAX_JOKES = 30
const MAX_MEMBERS = 60
const MAX_QUOTES = 8
const MAX_QUOTE_CHARS = 300
const MAX_NOTE_CHARS = 500

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

function strings(x: unknown, max: number, maxChars: number): string[] {
  if (!Array.isArray(x) || !x.every((s) => typeof s === 'string')) throw new Error('bad string list')
  return (x as string[]).slice(0, max).map((s) => s.slice(0, maxChars))
}

/** Validates the model reply. Throws on any missing or wrongly typed field. */
function toSummary(x: unknown, index: number): ChunkSummary {
  if (!isObject(x)) throw new Error('summary is not an object')
  const notes = x.memberNotes
  if (!isObject(notes)) throw new Error('memberNotes is not an object')
  // Sender names are untrusted: build the record without a prototype.
  const memberNotes: Record<string, string> = Object.create(null)
  let count = 0
  for (const [name, note] of Object.entries(notes)) {
    if (typeof note !== 'string') throw new Error('memberNotes value is not a string')
    if (++count > MAX_MEMBERS) break
    memberNotes[name] = note.slice(0, MAX_NOTE_CHARS)
  }
  return {
    index,
    events: strings(x.events, MAX_EVENTS, MAX_NOTE_CHARS),
    jokes: strings(x.jokes, MAX_JOKES, MAX_NOTE_CHARS),
    memberNotes,
    quotes: strings(x.quotes, MAX_QUOTES, MAX_QUOTE_CHARS),
  }
}

/** One model call that summarises a chunk. Throws llm_invalid_json when the reply cannot be used. */
export async function summarizeChunk(p: LlmProvider, chunk: Chunk, language: string): Promise<ChunkSummary> {
  const prompt = [
    `Language for the notes: ${safeLanguage(language)}.`,
    'Chat slice (one message per line, "--- date ---" marks a new day):',
    fence(chunk.text),
  ].join('\n\n')
  return generateJson(p, { system: SUMMARY_SYSTEM, prompt }, (x) => toSummary(x, chunk.index))
}
