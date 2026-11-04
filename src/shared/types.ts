export class ParseError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code)
    this.name = 'ParseError'
  }
}

export interface Message {
  id: number
  /** wall-clock time from the export, expressed as UTC ms (exports carry no timezone) */
  ts: number
  sender: string
  text: string
  kind: 'text' | 'media' | 'deleted'
  edited: boolean
}

export interface ParsedChat {
  messages: Message[]
  participants: string[]
  systemEvents: { ts: number; text: string }[]
  format: 'android' | 'ios'
  dateOrder: 'mdy' | 'dmy'
}

export interface MemberStats {
  messages: number
  words: number
  media: number
  deleted: number
  edited: number
  starters: number
  topEmojis: [string, number][]
  avgReplyMs: number | null
  busiestHour: number
}

export interface ChatStats {
  firstTs: number
  lastTs: number
  days: number
  total: number
  perMember: Record<string, MemberStats>
  hourHistogram: number[]
  weekdayHistogram: number[]
  busiestDay: { date: string; count: number }
  longestSilence: { fromTs: number; toTs: number }
  shiftWeek: { weekStart: string; ratio: number } | null
}

/** Story-card facts computed in the browser (see src/stats/extras.ts). */
export interface ChatExtras {
  /** per UTC day with at least one message, sorted by date */
  calendar: { date: string; count: number }[]
  /** longest run of consecutive days that each have a message; empty strings when there are none */
  streak: { days: number; fromDate: string; toDate: string }
  /** top 3 senders by message count, each with their longest text message by words */
  longestMessages: { sender: string; words: number; ts: number; text: string }[]
  firstMessages: { sender: string; text: string; ts: number }[]
  lastMessages: { sender: string; text: string; ts: number }[]
  /** laugh tokens per sender (senders with none are absent); prototype-free */
  laughs: Record<string, number>
  /** the longest single laugh token and its sender; length 0 and sender '' when none */
  laughRecord: { sender: string; length: number }
  topWords: [string, number][]
  topEmojis: [string, number][]
}

export type PersonaId = 'brandon' | 'clara' | 'diego'

/** A slice of the chat sent to the model in one call. fromId/toId are message ids (inclusive). */
export interface Chunk {
  index: number
  fromId: number
  toId: number
  text: string
}

export interface ChunkSummary {
  index: number
  events: string[]
  jokes: string[]
  /** keyed by sender name: a prototype-free record (sender names are untrusted) */
  memberNotes: Record<string, string>
  quotes: string[]
}

export interface GroupReport {
  title: string
  intro: string
  verdict: string
  dynamic: string
  shiftWeekNote: string
  runningJokes: string[]
  /** body is markdown; real quotes appear as lines starting with '> ' */
  sections: { emoji: string; heading: string; body: string }[]
  members: { name: string; nickname: string; opinion: string; quote?: string }[]
  advice: string
}
