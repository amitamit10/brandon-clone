import { generateJson, type LlmProvider, type LlmRequest } from '../llm/provider'
import { PERSONAS } from './personas'
import { cleanOneLine, fence, safeLanguage, sanitizeModelText } from './safety'
import type { ChatStats, ChunkSummary, GroupReport, MemberAura, ParsedChat, PersonaId } from '../shared/types'

export type ReportKind = 'group' | 'member' | 'followup'

export interface ReportInput {
  persona: PersonaId
  language: string
  /** the person who uploaded the chat (their own export name) */
  me: string
  stats: ChatStats
  summaries: ChunkSummary[]
  /** Direct mode: the whole chat as 'HH:MM Sender: text' lines, used instead of summaries (1M-token models). */
  transcript?: string
  kind: ReportKind
  /** member name, for kind 'member' */
  subject?: string
  /** the follow-up question, for kind 'followup' */
  question?: string
  /** raw message lines retrieved for a follow-up */
  retrieved?: string[]
}

const MAX_SUMMARY_CHARS = 75_000
/** Upper bound for a direct-mode transcript (about 700k tokens of mixed Hebrew/English). */
export const MAX_TRANSCRIPT_CHARS = 2_500_000
const MAX_RETRIEVED_CHARS = 8_000
const MAX_SECTIONS = 20
const MAX_MEMBERS = 60
const MAX_JOKES = 20
const MAX_BODY_CHARS = 8_000
const MAX_SHORT_CHARS = 2_000
const PROMPT_MEMBERS = 14
const MAX_NAME_CHARS = 40
const MAX_ASK_CHARS = 500
const MIN_QUOTE_CHARS = 4
const MAX_VERIFIED_QUOTES = 200

const NARRATIVE_REQUIREMENTS = [
  'Requirements:',
  '- Write at least 5 sections (aim for 5 to 7 rich, funny, and deeply detailed chapters). Focus on spicy, entertaining, and savage roast chapters (e.g. cheapness and unpaid debts, flake culture and ghosting, unhinged 3 AM reels/voice notes, group micro-dramas, running jokes, and the week things collapsed). One section must be the Official Group Aura Leaderboard ("🔮 מדד האורה של ברנדון") brutally ranking who has aura and who is in catastrophic aura debt. Each section body has at least 3 to 5 sentences.',
  '- Across the sections include at least 5 real quotes as blockquote lines that start with "> ", each copied verbatim from the supplied quotes or transcript. Each quote must be on its own line with a blank line before and after, like:\n\n> verbatim quote\n',
].join('\n')

const MEMBER_REQUIREMENTS = [
  '- members: MANDATORY: YOU MUST WRITE A FULL ENTRY FOR EVERY SINGLE MEMBER LISTED UNDER "Per member" (write a complete profile for all members listed under "Per member", do not skip anyone!). opinion is 3 to 5 sentences of a spicy, hilarious roast dissecting that specific person\'s worst habits and flaws. roast is 1 to 2 sharp, hilarious paragraphs roasting them specifically. quote is ONE line copied verbatim from that member without leading ">" and without quotation marks; leave it empty if there is no real line by that member.',
  '- member traits: for EVERY member include roast, smurf (e.g. "דרדס חופר - ..."), futurePrediction (satirical 5-10 year prediction), charisma (e.g. "6/10 - ..."), selfImage (e.g. "בטוח שהוא אל יווני | בפועל: ..."), favoriteCurse, and animal (spirit animal with emoji and reason).',
  '- aura: for EVERY member provide their quantified Aura Check: score (e.g. "+50,000 אורה", "-65,000 אורה"), status (e.g. "טונות של אורה", "פשיטת רגל של אורה"), peak (points, reason, quote), and loss (points, reason, quote showing where their aura dropped). Both peak.quote and loss.quote must be real verbatim lines from that member without leading ">" or quotes.',
  '- JSON FORMATTING: In Hebrew text inside JSON strings, NEVER write unescaped English double quotes ("). For acronyms (דוח, מנכל, צהל) or embedded quotes, write single quotes (\') or Hebrew gershayim (״) or write the word without quotes (דוח).',
].join('\n')

const REPORT_REQUIREMENTS = [NARRATIVE_REQUIREMENTS, MEMBER_REQUIREMENTS].join('\n')

/** Requirements for a members-only call: the profiles of the target members and nobody else. */
const MEMBER_BATCH_REQUIREMENTS = MEMBER_REQUIREMENTS.replace(
  /YOU MUST WRITE A FULL ENTRY FOR EVERY SINGLE MEMBER LISTED UNDER "Per member" \(write a complete profile for all 14 members, do not skip anyone!\)/,
  'YOU MUST WRITE A FULL ENTRY FOR EVERY MEMBER NAMED IN "targets" in the REQUEST DATA block, in that order, and for nobody else (do not skip anyone!)',
)

const REPORT_SCHEMA = `{
  "title": string, "intro": string, "verdict": string, "dynamic": string, "shiftWeekNote": string,
  "runningJokes": string[],
  "sections": [{"emoji": string, "heading": string, "body": string}],
  "members": [{
    "name": string, "nickname": string, "opinion": string, "roast": string, "quote": string,
    "smurf": string, "futurePrediction": string, "charisma": string, "selfImage": string,
    "favoriteCurse": string, "animal": string,
    "aura": {"score": string, "status": string, "peak": {"points": string, "reason": string, "quote": string}, "loss": {"points": string, "reason": string, "quote": string}}
  }],
  "advice": string
}`

const NARRATIVE_SCHEMA = `{
  "title": string, "intro": string, "verdict": string, "dynamic": string, "shiftWeekNote": string,
  "runningJokes": string[],
  "sections": [{"emoji": string, "heading": string, "body": string}],
  "advice": string
}`

const MEMBERS_SCHEMA = REPORT_SCHEMA.slice(REPORT_SCHEMA.indexOf('"members"'), REPORT_SCHEMA.indexOf('"advice"')).trim().replace(/,$/, '')

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

/** The members the prompt asks profiles for: the most active ones, plus the uploader. */
function topMembers(stats: ChatStats, me?: string) {
  const entries = Object.entries(stats.perMember)
    .filter(([name, m]) => m.messages >= 2 && name !== 'You')
    .sort((x, y) => y[1].messages - x[1].messages)
  const top = entries.slice(0, PROMPT_MEMBERS)
  if (me && !top.some(([n]) => n === me)) {
    const meNorm = me.replace(/[\p{Emoji}\s]/gu, '').toLowerCase()
    const meEntry = entries.find(
      ([n]) => n === me || (meNorm.length > 0 && n.replace(/[\p{Emoji}\s]/gu, '').toLowerCase().includes(meNorm)),
    )
    if (meEntry && !top.some(([n]) => n === meEntry[0])) {
      top.push(meEntry)
    }
  }
  return top
}

/** The stats block, formatted from the exact numbers computed by code. */
function statsBlock(stats: ChatStats, me?: string): string {
  const top = topMembers(stats, me)
  const lines = [
    `Chat: ${stats.total} messages from ${isoDay(stats.firstTs)} to ${isoDay(stats.lastTs)} (${stats.days} days).`,
    'Per member (YOU MUST WRITE A DEDICATED PROFILE ENTRY FOR EVERY SINGLE MEMBER LISTED HERE):',
    ...top.map(
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
    fence(statsBlock(a.stats, a.me)),
    ...(a.transcript !== undefined
      ? ['Full chat transcript (oldest first; lines are "HH:MM Sender: text"):', fence(a.transcript.slice(0, MAX_TRANSCRIPT_CHARS))]
      : ['Summaries of the chat, in order:', fence(summariesBlock(a.summaries) || '(no summaries)')]),
    'REQUEST DATA (JSON; "me" is the person who asked for this report):',
    fence(requestData),
    requestBlock(a),
    REPORT_REQUIREMENTS,
    `Reply with ONLY JSON matching this shape:\n${REPORT_SCHEMA}`,
  ].join('\n\n')
}

function resolveParticipantName(name: string, known: Set<string>): string | null {
  if (known.has(name)) return name
  const clean = (s: string) => s.replace(/[\p{Emoji}\p{Symbol}\p{Punctuation}]/gu, '').trim().toLowerCase()
  const targetClean = clean(name)
  if (!targetClean) return null
  for (const k of known) {
    if (clean(k) === targetClean) return k
  }
  if (targetClean.length >= 3) {
    for (const k of known) {
      const kClean = clean(k)
      if (kClean.startsWith(targetClean) || targetClean.startsWith(kClean)) return k
    }
  }
  return null
}

function toReport(x: unknown, a: ReportInput): GroupReport {
  if (!isObject(x)) throw new Error('report is not an object')
  const followup = a.kind === 'followup'
  const full = !followup
  const sectionsRaw = list(x.sections, MAX_SECTIONS)
  const sections = sectionsRaw.map((s) => {
    if (!isObject(s)) throw new Error('section is not an object')
    const emoji = typeof s.emoji === 'string' && s.emoji.trim() ? str(s.emoji, 16) : '📝'
    const heading = typeof s.heading === 'string' && s.heading.trim() ? str(s.heading) : 'פרק'
    return { emoji, heading, body: str(s.body ?? '', MAX_BODY_CHARS) }
  })
  if (sections.length === 0) throw new Error('no sections')

  // members and runningJokes may be absent (followups); absent means empty.
  const membersRaw = x.members === undefined ? [] : list(x.members, MAX_MEMBERS)
  const known = new Set(Object.keys(a.stats.perMember))
  const members = membersRaw.map((m) => {
    if (!isObject(m)) throw new Error('member is not an object')
    // A quote may be absent (undefined or null). If present it must be a string.
    const quote = m.quote === undefined || m.quote === null ? undefined : str(m.quote)
    const getField = (keys: string[], max = MAX_SHORT_CHARS): string | undefined => {
      for (const k of keys) {
        const val = (m as Record<string, unknown>)[k]
        if (typeof val === 'string' && val.trim().length > 0) return str(val, max)
      }
      return undefined
    }

    const animal = getField(['animal', 'spiritAnimal', 'spirit_animal', 'favoriteAnimal', 'favorite_animal'])
    const smurf = getField(['smurf', 'smurfPersona', 'smurf_persona', 'smurfCharacter', 'smurf_character'])
    const futurePrediction = getField(['futurePrediction', 'future_prediction', 'future', 'prediction'])
    const charisma = getField(['charisma', 'charismaScore', 'charisma_score', 'charm'])
    const selfImage = getField(['selfImage', 'self_image', 'selfPerception', 'self_perception', 'look'])
    const favoriteCurse = getField(['favoriteCurse', 'favorite_curse', 'curse', 'catchphrase', 'slang'])
    const roast = getField(['roast', 'personalRoast', 'personal_roast'], MAX_BODY_CHARS)

    let aura: MemberAura | undefined = undefined
    if (isObject(m.aura)) {
      const score = typeof m.aura.score === 'string' ? str(m.aura.score) : typeof m.aura.score === 'number' ? String(m.aura.score) : '0'
      const status = typeof m.aura.status === 'string' ? str(m.aura.status) : ''
      const peak = isObject(m.aura.peak)
        ? {
            points: typeof m.aura.peak.points === 'string' ? str(m.aura.peak.points) : '+1,000',
            reason: typeof m.aura.peak.reason === 'string' ? str(m.aura.peak.reason) : '',
            ...(typeof m.aura.peak.quote === 'string' && m.aura.peak.quote.trim().length > 0 ? { quote: str(m.aura.peak.quote) } : {}),
          }
        : undefined
      const loss = isObject(m.aura.loss)
        ? {
            points: typeof m.aura.loss.points === 'string' ? str(m.aura.loss.points) : '-1,000',
            reason: typeof m.aura.loss.reason === 'string' ? str(m.aura.loss.reason) : '',
            ...(typeof m.aura.loss.quote === 'string' && m.aura.loss.quote.trim().length > 0 ? { quote: str(m.aura.loss.quote) } : {}),
          }
        : undefined
      aura = { score, status, ...(peak ? { peak } : {}), ...(loss ? { loss } : {}) }
    }
    const rawName = str(m.name)
    const canonicalName = resolveParticipantName(rawName, known)
    const name = canonicalName ?? rawName
    const nickname = typeof m.nickname === 'string' && m.nickname.trim() ? str(m.nickname) : name
    const opinion = typeof m.opinion === 'string' && m.opinion.trim() ? str(m.opinion, MAX_BODY_CHARS) : (roast ?? 'חבר קבוצה פעיל.')
    return {
      name,
      nickname,
      opinion,
      ...(roast ? { roast } : {}),
      ...(animal ? { animal } : {}),
      ...(smurf ? { smurf } : {}),
      ...(futurePrediction ? { futurePrediction } : {}),
      ...(charisma ? { charisma } : {}),
      ...(selfImage ? { selfImage } : {}),
      ...(favoriteCurse ? { favoriteCurse } : {}),
      ...(quote ? { quote } : {}),
      ...(aura ? { aura } : {}),
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
    shiftWeekNote: optStr(x.shiftWeekNote, MAX_BODY_CHARS),
    runningJokes: (jokesRaw as string[]).map((j) => j.slice(0, MAX_SHORT_CHARS)),
    sections,
    members,
    advice: typeof x.advice === 'string' ? str(x.advice, MAX_BODY_CHARS) : (full ? 'שתו מים ותרגיעו את הוויב בקבוצה.' : ''),
  }
}

/** One model call (plus at most one repair) that writes a report in the chosen persona. */
export async function generateReport(p: LlmProvider, a: ReportInput): Promise<GroupReport> {
  const req: LlmRequest = { system: PERSONAS[a.persona].system, prompt: buildPrompt(a), maxTokens: 10000 }
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
    members: r.members.map((m) => ({
      ...m,
      name: m.name,
      nickname: t(m.nickname),
      opinion: t(m.opinion),
      ...(m.roast !== undefined ? { roast: t(m.roast) } : {}),
      ...(m.animal !== undefined ? { animal: t(m.animal) } : {}),
      ...(m.smurf !== undefined ? { smurf: t(m.smurf) } : {}),
      ...(m.futurePrediction !== undefined ? { futurePrediction: t(m.futurePrediction) } : {}),
      ...(m.charisma !== undefined ? { charisma: t(m.charisma) } : {}),
      ...(m.selfImage !== undefined ? { selfImage: t(m.selfImage) } : {}),
      ...(m.favoriteCurse !== undefined ? { favoriteCurse: t(m.favoriteCurse) } : {}),
      ...(m.quote !== undefined ? { quote: t(m.quote) } : {}),
      ...(m.aura !== undefined
        ? {
            aura: {
              score: t(m.aura.score),
              status: t(m.aura.status),
              ...(m.aura.peak
                ? {
                    peak: {
                      points: t(m.aura.peak.points),
                      reason: t(m.aura.peak.reason),
                      ...(m.aura.peak.quote ? { quote: t(m.aura.peak.quote) } : {}),
                    },
                  }
                : {}),
              ...(m.aura.loss
                ? {
                    loss: {
                      points: t(m.aura.loss.points),
                      reason: t(m.aura.loss.reason),
                      ...(m.aura.loss.quote ? { quote: t(m.aura.loss.quote) } : {}),
                    },
                  }
                : {}),
            },
          }
        : {}),
    })),
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

export type QuoteSource =
  | ParsedChat
  | {
      messages?: Message[]
      chunks?: { text: string }[]
      participants?: string[]
      stats?: ChatStats
    }

/**
 * Drops every quote that is not a substring of one text message (media/deleted messages are ignored).
 * Member quotes must come from that member's own messages; section '> ' quotes from any member.
 * Quotes shorter than MIN_QUOTE_CHARS never count. Returns a new report; the input is not changed.
 */
export function verifyQuotes(report: GroupReport, chat: QuoteSource): GroupReport {
  const hasMessages = Array.isArray(chat.messages) && chat.messages.length > 0
  const bySender = new Map<string, string[]>()
  const all: string[] = []
  if (hasMessages) {
    for (const m of chat.messages!) {
      if (m.kind !== 'text') continue
      const n = normalise(m.text)
      all.push(n)
      const list = bySender.get(m.sender)
      if (list) list.push(n)
      else bySender.set(m.sender, [n])
    }
  }
  const hayAll = all.join('\u0001')
  const haySender = new Map<string, string>()
  for (const [k, v] of bySender) haySender.set(k, v.join('\u0001'))

  const chunkTexts = 'chunks' in chat && Array.isArray(chat.chunks) ? chat.chunks.map((c) => c.text) : []

  const verified = (raw: string, sender?: string): string | undefined => {
    // Models often copy the blockquote marker into a member's quote field: strip it before checking.
    let start = 0
    while (start < raw.length && (raw[start] === '>' || raw[start] === ' ' || raw[start] === '\t')) start++
    const clean = cleanOneLine(unwrap(raw.slice(start).trim()), MAX_SHORT_CHARS)
    let n = normalise(clean)
    if (n.length < MIN_QUOTE_CHARS) return undefined

    // If sender was included as a prefix (e.g. "Dana: hello" or "Dana - hello"), strip it
    if (sender !== undefined) {
      const sPrefix = normalise(sender)
      if (n.startsWith(`${sPrefix}:`)) n = n.slice(sPrefix.length + 1).trim()
      else if (n.startsWith(`${sPrefix} -`)) n = n.slice(sPrefix.length + 2).trim()
    }

    if (hasMessages) {
      const hay = sender === undefined ? hayAll : haySender.get(sender)
      return hay !== undefined && hay.includes(n) ? clean : undefined
    }

    // Fast chunk check: avoids reconstructing 100k+ messages and runs in < 0.1ms CPU
    const sNeedle = sender ? normalise(sender) : undefined
    for (const chunk of chunkTexts) {
      if (!normalise(chunk).includes(n)) continue
      if (!sNeedle) return clean
      for (const line of chunk.split('\n')) {
        const normLine = normalise(line)
        if (normLine.includes(sNeedle) && normLine.includes(n)) {
          return clean
        }
      }
    }
    return undefined
  }

  let keptQuotes = 0
  const cleanBody = (body: string): string => {
    const out: string[] = []
    let needBlank = false
    // If quotes are embedded inline like "text. > quote", split them onto new lines
    const normalizedBody = body
      .replace(/\r\n?/g, '\n')
      .replace(/([^\n])\s*>\s+/g, '$1\n> ')
    for (const line of normalizedBody.split('\n')) {
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
      let aura = m.aura
      if (aura) {
        const peakQuote = aura.peak?.quote ? verified(aura.peak.quote, m.name) : undefined
        const lossQuote = aura.loss?.quote ? verified(aura.loss.quote, m.name) : undefined
        const { quote: _pq, ...cleanPeak } = aura.peak ?? { points: '', reason: '' }
        const { quote: _lq, ...cleanLoss } = aura.loss ?? { points: '', reason: '' }
        aura = {
          ...aura,
          ...(aura.peak
            ? {
                peak: {
                  ...cleanPeak,
                  ...(peakQuote !== undefined ? { quote: peakQuote } : {}),
                },
              }
            : {}),
          ...(aura.loss
            ? {
                loss: {
                  ...cleanLoss,
                  ...(lossQuote !== undefined ? { quote: lossQuote } : {}),
                },
              }
            : {}),
        }
      }
      const { quote: _oldQuote, aura: _oldAura, ...rest } = m
      return {
        ...rest,
        name: m.name,
        nickname: m.nickname,
        opinion: m.opinion,
        ...(q !== undefined ? { quote: q } : {}),
        ...(aura !== undefined ? { aura } : {}),
      }
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
