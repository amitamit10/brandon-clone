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
