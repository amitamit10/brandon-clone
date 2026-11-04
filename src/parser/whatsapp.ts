import { ParseError, type Message, type ParsedChat } from '../shared/types'

// Hidden direction marks WhatsApp wraps around names, plus BOM.
const INVISIBLE = /[‎‏‪-‮⁦-⁩﻿]/g

const TIME = String.raw`(\d{1,2}):(\d{2})(?::(\d{2}))?[\s  ]?([AaPp]\.?[Mm]\.?)?`
const DATE = String.raw`(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})`
const ANDROID = new RegExp(String.raw`^${DATE},? ${TIME} - (.*)$`)
const IOS = new RegExp(String.raw`^\[${DATE},? ${TIME}\] (.*)$`)

const MEDIA = /^<?(media|image|video|audio|sticker|gif|document|contact card|voice call|video call)( omitted)?>?$|^<Media omitted>$|^(image|video|audio|sticker|GIF|document) omitted$/i
const DELETED = /^(This message was deleted|You deleted this message)\.?$/
const EDITED_SUFFIX = '<This message was edited>'

interface Header {
  a: number
  b: number
  year: number
  h: number
  mi: number
  s: number
  ampm?: string
  rest: string
}

function matchHeader(line: string, re: RegExp): Header | null {
  const m = re.exec(line)
  if (!m) return null
  let year = Number(m[3])
  if (year < 100) year += 2000
  return { a: Number(m[1]), b: Number(m[2]), year, h: Number(m[4]), mi: Number(m[5]), s: Number(m[6] ?? 0), ampm: m[7], rest: m[8] }
}

function toTs(h: Header, order: 'mdy' | 'dmy'): number {
  const day = order === 'mdy' ? h.b : h.a
  const month = order === 'mdy' ? h.a : h.b
  let hour = h.h
  if (h.ampm) {
    const pm = h.ampm.toLowerCase().startsWith('p')
    if (pm && hour < 12) hour += 12
    if (!pm && hour === 12) hour = 0
  }
  return Date.UTC(h.year, month - 1, day, hour, h.mi, h.s)
}

export function parseExport(text: string): ParsedChat {
  const lines = text.replace(INVISIBLE, '').split(/\r?\n/)

  const androidHits = lines.filter((l) => ANDROID.test(l)).length
  const iosHits = lines.filter((l) => IOS.test(l)).length
  if (androidHits === 0 && iosHits === 0) throw new ParseError('no_messages')
  const format: 'android' | 'ios' = iosHits > androidHits ? 'ios' : 'android'
  const re = format === 'ios' ? IOS : ANDROID

  const headers = lines.map((l) => matchHeader(l, re))
  let firstOver12 = false
  let secondOver12 = false
  for (const h of headers) {
    if (!h) continue
    if (h.a > 12) firstOver12 = true
    if (h.b > 12) secondOver12 = true
  }
  const dateOrder: 'mdy' | 'dmy' = firstOver12 ? 'dmy' : secondOver12 ? 'mdy' : format === 'ios' ? 'dmy' : 'mdy'

  type Entry = { ts: number; sender: string | null; text: string }
  const entries: Entry[] = []
  lines.forEach((line, i) => {
    const h = headers[i]
    if (h) {
      const idx = h.rest.indexOf(': ')
      const sender = idx > 0 ? h.rest.slice(0, idx) : null
      entries.push({ ts: toTs(h, dateOrder), sender, text: sender === null ? h.rest : h.rest.slice(idx + 2) })
    } else if (entries.length > 0) {
      entries[entries.length - 1].text += '\n' + line
    }
  })

  const messages: Message[] = []
  const systemEvents: { ts: number; text: string }[] = []
  const participants: string[] = []
  for (const e of entries) {
    if (e.sender === null) {
      systemEvents.push({ ts: e.ts, text: e.text.trim() })
      continue
    }
    // Linear string ops only (no backtracking regex on untrusted input).
    let body = e.text.trimEnd()
    const edited = body.endsWith(EDITED_SUFFIX)
    if (edited) body = body.slice(0, -EDITED_SUFFIX.length)
    const trimmed = body.trim()
    const kind: Message['kind'] = DELETED.test(trimmed) ? 'deleted' : MEDIA.test(trimmed) ? 'media' : 'text'
    if (!participants.includes(e.sender)) participants.push(e.sender)
    messages.push({ id: messages.length, ts: e.ts, sender: e.sender, text: trimmed, kind, edited })
  }

  if (messages.length === 0) throw new ParseError('no_messages')
  return { messages, participants, systemEvents, format, dateOrder }
}
