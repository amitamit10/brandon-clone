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
