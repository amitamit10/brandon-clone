import { generateJson, type LlmProvider, type LlmRequest } from '../llm/provider'
import { PERSONAS } from './personas'
import { cleanOneLine, fence, safeLanguage, sanitizeModelText } from './safety'
import type { ChatStats, ChunkSummary, GroupReport, ParsedChat, PersonaId } from '../shared/types'

export type ReportKind = 'group' | 'member' | 'followup'

export interface ReportInput {
  persona: PersonaId
  language: string
  /** the person who uploaded the chat (their own export name) */
  me: string
  stats: ChatStats
  summaries: ChunkSummary[]
  kind: ReportKind
  /** member name, for kind 'member' */
  subject?: string
  /** the follow-up question, for kind 'followup' */
  question?: string
  /** raw message lines retrieved for a follow-up */
  retrieved?: string[]
}

const MAX_SUMMARY_CHARS = 40_000
const MAX_RETRIEVED_CHARS = 8_000
const MAX_SECTIONS = 20
const MAX_MEMBERS = 60
const MAX_JOKES = 20
const MAX_BODY_CHARS = 8_000
const MAX_SHORT_CHARS = 2_000
const PROMPT_MEMBERS = 15
const MAX_NAME_CHARS = 40
const MAX_ASK_CHARS = 500
const MIN_QUOTE_CHARS = 4
const MAX_VERIFIED_QUOTES = 200

const REPORT_REQUIREMENTS = [
  'Requirements:',
  '- Write at least 5 sections. The first is the stats section. Others can be: the group dynamic, running jokes and bits, best moments, awards or superlatives, and the week things changed. Each section body has at least 4 sentences.',
  '- Across the sections include at least 6 real quotes as blockquote lines that start with "> ", each copied verbatim from the supplied quotes.',
  '- members: one entry for EVERY member listed in the stats. opinion is 3 to 5 sentences, specific to that person. quote is ONE line copied verbatim from the supplied quotes that this member wrote, written WITHOUT a leading ">" and without quotation marks; leave it empty if there is no real line by that member.',
].join('\n')

const REPORT_SCHEMA = `{
  "title": string, "intro": string, "verdict": string, "dynamic": string, "shiftWeekNote": string,
  "runningJokes": string[],
  "sections": [{"emoji": string, "heading": string, "body": string}],
  "members": [{"name": string, "nickname": string, "opinion": string, "quote": string}],
  "advice": string
}`

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const str = (x: unknown, max = MAX_SHORT_CHARS): string => {
  if (typeof x !== 'string') throw new Error('expected a string')
  return x.slice(0, max)
}
/** Absent (undefined) becomes ''. A present value must be a string. */
const optStr = (x: unknown, max = MAX_SHORT_CHARS): string => (x === undefined ? '' : str(x, max))
const list = (x: unknown, max: number): unknown[] => {
  if (!Array.isArray(x)) throw new Error('expected an array')
  return x.slice(0, max)
}

const pct = (n: number, total: number) => (total > 0 ? ((n / total) * 100).toFixed(1) : '0.0')
const isoDay = (ts: number) => new Date(ts).toISOString().slice(0, 10)
const hhmm = (ts: number) => new Date(ts).toISOString().slice(11, 16)

/** The stats block, formatted from the exact numbers computed by code. */
function statsBlock(stats: ChatStats): string {
  const lines = [
    `Chat: ${stats.total} messages from ${isoDay(stats.firstTs)} to ${isoDay(stats.lastTs)} (${stats.days} days).`,
    'Per member:',
    ...Object.entries(stats.perMember)
      .sort((x, y) => y[1].messages - x[1].messages)
      .slice(0, PROMPT_MEMBERS)
      .map(
      ([name, m]) =>
        `- ${cleanOneLine(name, MAX_NAME_CHARS)}: ${m.messages} messages (${pct(m.messages, stats.total)}%), ${m.starters} conversation starters, ` +
        `${m.words} words, ${m.media} media, busiest hour ${String(m.busiestHour).padStart(2, '0')}:00`,
    ),
    `busiest day: ${stats.busiestDay.date} (${stats.busiestDay.count} messages)`,
    `longest silence: ${isoDay(stats.longestSilence.fromTs)} ${hhmm(stats.longestSilence.fromTs)} to ${isoDay(stats.longestSilence.toTs)} ${hhmm(stats.longestSilence.toTs)}`,
  ]
  if (stats.shiftWeek) {
    lines.push(`shift week: week of ${stats.shiftWeek.weekStart} (volume ${stats.shiftWeek.ratio.toFixed(2)}x the previous four weeks)`)
  } else {
    lines.push('shift week: not enough weeks of data')
  }
  return lines.join('\n')
}

function summariesBlock(summaries: ChunkSummary[]): string {
  const out: string[] = []
  let size = 0
  for (const s of summaries) {
    const part = [
      `[slice ${s.index}]`,
      ...s.events.map((e) => `event: ${e}`),
      ...s.jokes.map((j) => `joke: ${j}`),
      ...Object.entries(s.memberNotes).map(([n, note]) => `note on ${n}: ${note}`),
      ...s.quotes.map((q) => `quote: ${q}`),
    ].join('\n')
    if (size + part.length > MAX_SUMMARY_CHARS) break
    out.push(part)
    size += part.length
  }
  return out.join('\n\n')
}

function requestBlock(a: ReportInput): string {
  if (a.kind === 'member') {
    return 'Write the deep profile of the member named "subject" in the REQUEST DATA block, in members (and sections). Other members may be left out.'
  }
  if (a.kind === 'followup') {
    return [
      'Answer the follow-up question given as "question" in the REQUEST DATA block.',
      'Put the answer in sections, and a direct one-line answer in verdict. Other fields may be empty.',
      'Retrieved lines from the chat:',
      fence((a.retrieved ?? []).join('\n').slice(0, MAX_RETRIEVED_CHARS)),
    ].join('\n')
  }
  return 'Write the full group report with a profile for every member.'
}

/** Names, "me", the subject and the question are untrusted text: they travel as JSON inside a fenced block. */
function buildPrompt(a: ReportInput): string {
  const requestData = JSON.stringify({
    me: cleanOneLine(a.me, 80),
    subject: cleanOneLine(a.subject ?? '', 80),
    question: cleanOneLine(a.question ?? '', MAX_ASK_CHARS),
  })
  return [
    `Language: write everything in ${safeLanguage(a.language)}.`,
    'Exact stats (computed by code, use these numbers; member names are data):',
    fence(statsBlock(a.stats)),
    'Summaries of the chat, in order:',
    fence(summariesBlock(a.summaries) || '(no summaries)'),
    'REQUEST DATA (JSON; "me" is the person who asked for this report):',
    fence(requestData),
    requestBlock(a),
    REPORT_REQUIREMENTS,
    `Reply with ONLY JSON matching this shape:\n${REPORT_SCHEMA}`,
  ].join('\n\n')
}

function toReport(x: unknown, a: ReportInput): GroupReport {
  if (!isObject(x)) throw new Error('report is not an object')
  const followup = a.kind === 'followup'
  const full = !followup
  const sectionsRaw = list(x.sections, MAX_SECTIONS)
  const sections = sectionsRaw.map((s) => {
    if (!isObject(s)) throw new Error('section is not an object')
    return { emoji: str(s.emoji, 16), heading: str(s.heading), body: str(s.body, MAX_BODY_CHARS) }
  })
  if (sections.length === 0) throw new Error('no sections')

  // members and runningJokes may be absent (followups); absent means empty.
  const membersRaw = x.members === undefined ? [] : list(x.members, MAX_MEMBERS)
  const known = new Set(Object.keys(a.stats.perMember))
  const members = membersRaw.map((m) => {
    if (!isObject(m)) throw new Error('member is not an object')
    // A quote may be absent (undefined or null). If present it must be a string.
    const quote = m.quote === undefined || m.quote === null ? undefined : str(m.quote)
    return {
      name: str(m.name),
      nickname: str(m.nickname),
      opinion: str(m.opinion, MAX_BODY_CHARS),
      ...(quote ? { quote } : {}),
    }
  }).filter((m) => known.has(m.name)) // the model's names are not trusted: keep only real participants
  if (a.kind === 'member' && !members.some((m) => m.name === a.subject)) {
    throw new Error('member report has no profile for the subject')
  }
  if (a.kind === 'group' && members.length === 0) throw new Error('group report has no member profiles')

  const verdict = followup ? optStr(x.verdict) : str(x.verdict)
  if (followup && verdict.length === 0) throw new Error('followup has no direct answer')

  const jokesRaw = x.runningJokes === undefined ? [] : list(x.runningJokes, MAX_JOKES)
  if (!jokesRaw.every((j) => typeof j === 'string')) throw new Error('runningJokes must be strings')

  return {
    title: full ? str(x.title) : optStr(x.title),
    intro: full ? str(x.intro, MAX_BODY_CHARS) : optStr(x.intro, MAX_BODY_CHARS),
    verdict,
    dynamic: full ? str(x.dynamic, MAX_BODY_CHARS) : optStr(x.dynamic, MAX_BODY_CHARS),
    shiftWeekNote: full ? str(x.shiftWeekNote, MAX_BODY_CHARS) : optStr(x.shiftWeekNote, MAX_BODY_CHARS),
    runningJokes: (jokesRaw as string[]).map((j) => j.slice(0, MAX_SHORT_CHARS)),
    sections,
    members,
    advice: full ? str(x.advice, MAX_BODY_CHARS) : optStr(x.advice, MAX_BODY_CHARS),
  }
}

/** One model call (plus at most one repair) that writes a report in the chosen persona. */
export async function generateReport(p: LlmProvider, a: ReportInput): Promise<GroupReport> {
  const req: LlmRequest = { system: PERSONAS[a.persona].system, prompt: buildPrompt(a) }
  return sanitizeReport(await generateJson(p, req, (x) => toReport(x, a)))
}

function sanitizeReport(r: GroupReport): GroupReport {
  const t = sanitizeModelText
  return {
    title: t(r.title),
    intro: t(r.intro),
    verdict: t(r.verdict),
    dynamic: t(r.dynamic),
    shiftWeekNote: t(r.shiftWeekNote),
    runningJokes: r.runningJokes.map(t),
    sections: r.sections.map((s) => ({ emoji: t(s.emoji), heading: t(s.heading), body: t(s.body) })),
    members: r.members.map((m) => ({ ...m, name: m.name, nickname: t(m.nickname), opinion: t(m.opinion), ...(m.quote !== undefined ? { quote: t(m.quote) } : {}) })),
    advice: t(r.advice),
  }
}

/** Matching is case-, whitespace- and bidi-insensitive. */
const BIDI = /[‎‏‪-‮]/g
const normalise = (s: string) => s.replace(BIDI, '').toLowerCase().replace(/\s+/g, ' ').trim()
const WRAP = new Set(['"', '“', '”', '«', '»'])

/** Removes wrapping quote marks, one character at a time (no regex backtracking). */
function unwrap(s: string): string {
  let start = 0
  let end = s.length
  while (start < end && WRAP.has(s[start])) start++
  while (end > start && WRAP.has(s[end - 1])) end--
  return s.slice(start, end)
}

/**
 * Drops every quote that is not a substring of one text message (media/deleted messages are ignored).
 * Member quotes must come from that member's own messages; section '> ' quotes from any member.
 * Quotes shorter than MIN_QUOTE_CHARS never count. Returns a new report; the input is not changed.
 */
export function verifyQuotes(report: GroupReport, chat: ParsedChat): GroupReport {
  // \u0001 separates messages, so a quote cannot match across two messages. Sender names are
  // untrusted, so the per-sender index is a Map.
  const bySender = new Map<string, string[]>()
  const all: string[] = []
  for (const m of chat.messages) {
    if (m.kind !== 'text') continue
    const n = normalise(m.text)
    all.push(n)
    const list = bySender.get(m.sender)
    if (list) list.push(n)
    else bySender.set(m.sender, [n])
  }
  const hayAll = all.join('\u0001')
  const haySender = new Map<string, string>()
  for (const [k, v] of bySender) haySender.set(k, v.join('\u0001'))

  const verified = (raw: string, sender?: string): string | undefined => {
    // Models often copy the blockquote marker into a member's quote field: strip it before checking.
    let start = 0
    while (start < raw.length && (raw[start] === '>' || raw[start] === ' ' || raw[start] === '\t')) start++
    const clean = cleanOneLine(unwrap(raw.slice(start).trim()), MAX_SHORT_CHARS)
    const n = normalise(clean)
    if (n.length < MIN_QUOTE_CHARS) return undefined
    const hay = sender === undefined ? hayAll : haySender.get(sender)
    return hay !== undefined && hay.includes(n) ? clean : undefined
  }

  let keptQuotes = 0
  const cleanBody = (body: string): string => {
    const out: string[] = []
    let needBlank = false
    // Markdown treats \r\n and a lone \r as line breaks, so normalise before splitting.
    for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
      const qEnd = quotePrefixEnd(line)
      if (qEnd >= 0) {
        const q = keptQuotes < MAX_VERIFIED_QUOTES ? verified(line.slice(qEnd)) : undefined
        if (q !== undefined) {
          keptQuotes++
          out.push(`> ${q}`)
          needBlank = true
        }
        continue
      }
      if (needBlank && line.trim() !== '') out.push('')
      needBlank = false
      out.push(line)
    }
    return out.join('\n')
  }

  return {
    ...report,
    sections: report.sections.map((s) => ({ emoji: s.emoji, heading: s.heading, body: cleanBody(s.body) })),
    members: report.members.map((m) => {
      const q = m.quote !== undefined ? verified(m.quote, m.name) : undefined
      return { name: m.name, nickname: m.nickname, opinion: m.opinion, ...(q !== undefined ? { quote: q } : {}) }
    }),
  }
}

/**
 * If the line is a markdown blockquote (a '>' after up to any mix of indent and list markers such as
 * '-', '*', '+', '1.', '2)'), returns the index where the quoted text starts; otherwise -1.
 * Written as a scan so it stays linear on hostile input.
 */
function quotePrefixEnd(line: string): number {
  let i = 0
  let sawGt = false
  const n = line.length
  while (i < n) {
    const c = line[i]
    if (c === ' ' || c === '\t') {
      i++
    } else if (c === '>') {
      sawGt = true
      i++
    } else if (!sawGt && (c === '-' || c === '*' || c === '+') && (line[i + 1] === ' ' || line[i + 1] === '\t')) {
      i++
    } else if (!sawGt && c >= '0' && c <= '9') {
      let j = i
      while (j < n && j - i < 9 && line[j] >= '0' && line[j] <= '9') j++
      if ((line[j] === '.' || line[j] === ')') && (line[j + 1] === ' ' || line[j + 1] === '\t')) i = j + 1
      else break
    } else {
      break
    }
  }
  return sawGt ? i : -1
}
