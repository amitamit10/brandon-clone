import type { ChatExtras, Message, ParsedChat } from '../shared/types'
import { emojiGraphemes } from './emoji'

// Pure TypeScript, runs in the browser. Sender names are untrusted: sender-keyed data uses Map,
// and the one record returned (laughs) is prototype-free.

const DAY = 86_400_000
const TEXT_CAP = 600
const EDGE_CAP = 200
const TOP_SENDERS = 3
const TOP_WORDS = 5
const TOP_EMOJIS = 5
const EDGE_COUNT = 5
const LAUGH_EMOJI = new Set(['😂', '🤣'])
// Deliberately limited to recognizable terms; this is not a claim about who was addressed.
const ADDRESS_TERMS = new Set(['אחי', 'אחשלי', 'אחותי', 'חבר', 'חברים', 'bro', 'sis', 'mate', 'buddy', 'dude', 'friend'])

const ENGLISH_STOP = [
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'had', 'her', 'was', 'one', 'our', 'out',
  'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'two', 'who', 'did', 'let', 'put',
  'say', 'she', 'too', 'use', 'that', 'with', 'have', 'this', 'will', 'your', 'from', 'they', 'know', 'want', 'been',
  'good', 'much', 'some', 'time', 'very', 'when', 'come', 'here', 'just', 'like', 'long', 'make', 'many', 'more',
  'only', 'over', 'such', 'take', 'than', 'them', 'well', 'were', 'what', 'there', 'their', 'which', 'would', 'about',
  'could', 'other', 'into', 'also', 'because', 'really', 'yeah', 'okay', 'gonna', 'going', 'think', 'then', 'got',
]

const HEBREW_STOP = [
  'את', 'של', 'על', 'עם', 'זה', 'זאת', 'זו', 'לא', 'כן', 'אני', 'אתה', 'הוא', 'היא', 'אנחנו', 'הם', 'הן',
  'מה', 'מי', 'איך', 'גם', 'כי', 'אם', 'אבל', 'רק', 'כל', 'יש', 'אין', 'היה', 'אז', 'עוד', 'כמו', 'שלי',
  'שלך', 'שלו', 'שלה', 'כך', 'ככה', 'פה', 'שם', 'כאן', 'יותר', 'לכם', 'לנו', 'להם', 'לך', 'לי', 'לו', 'לה',
  'אותו', 'אותה', 'מאוד', 'הרבה', 'כבר', 'ממש', 'אחד', 'אחת', 'לפני', 'אחרי', 'אצל', 'בגלל', 'שוב', 'כולם',
  'אולי', 'ואז', 'תמיד', 'אפילו', 'וגם', 'ועוד',
]

/** Common English and Hebrew words that do not count as "most used words". */
export const STOP_WORDS: Set<string> = new Set([...ENGLISH_STOP, ...HEBREW_STOP])

const isoDay = (ts: number) => new Date(ts).toISOString().slice(0, 10)
const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY
const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length
const isJunk = (ch: string) => /^[\p{P}\p{S}]$/u.test(ch)

/** Strips leading and trailing punctuation and symbols. Walks code points, so no regex backtracking. */
function trimEdges(token: string): string {
  const chars = Array.from(token)
  let start = 0
  let end = chars.length
  while (start < end && isJunk(chars[start])) start++
  while (end > start && isJunk(chars[end - 1])) end--
  return chars.slice(start, end).join('')
}

/** Laugh words: 'haha'/'hehe' (repeated 2+ times), lo+l ('lol', 'lool'), lmao+, rofl, Hebrew 'חח' (2+). */
function isLaughWord(w: string): boolean {
  if (w.length < 2) return false
  return /^(?:ha|he){2,}$/.test(w) || /^lo+l$/.test(w) || /^lmao+$/.test(w) || w === 'rofl' || /^ח{2,}$/u.test(w)
}

function streakOf(calendar: { date: string }[]): ChatExtras['streak'] {
  let best = { days: 0, fromDate: '', toDate: '' }
  let runStart = 0
  for (let i = 0; i < calendar.length; i++) {
    const contiguous = i > 0 && dayNumber(calendar[i].date) - dayNumber(calendar[i - 1].date) === 1
    if (!contiguous) runStart = i
    const length = i - runStart + 1
    if (length > best.days) best = { days: length, fromDate: calendar[runStart].date, toDate: calendar[i].date }
  }
  return best
}

/** Insertion-ordered counts; sorting a Map's entries with a stable sort keeps first-appearance order on ties. */
function topEntries(counts: Map<string, number>, n: number): [string, number][] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
}

export function computeExtras(chat: ParsedChat): ChatExtras {
  const messages: Message[] = chat.messages
  const texts = messages.filter((m) => m.kind === 'text')

  // calendar and streak use every message (media included)
  const perDay = new Map<string, number>()
  const perSender = new Map<string, number>()
  for (const m of messages) {
    const day = isoDay(m.ts)
    perDay.set(day, (perDay.get(day) ?? 0) + 1)
    perSender.set(m.sender, (perSender.get(m.sender) ?? 0) + 1)
  }
  const calendar = [...perDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, count]) => ({ date, count }))

  // longest text message per sender; strict '>' keeps the earliest on ties
  const longestBy = new Map<string, { message: Message; words: number }>()
  for (const m of texts) {
    const words = wordCount(m.text)
    const current = longestBy.get(m.sender)
    if (!current || words > current.words) longestBy.set(m.sender, { message: m, words })
  }
  const topSenders = [...perSender.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_SENDERS)
    .map(([sender]) => sender)
  const longestMessages = topSenders
    .filter((sender) => longestBy.has(sender))
    .map((sender) => {
      const { message, words } = longestBy.get(sender)!
      return { sender, words, ts: message.ts, text: message.text.slice(0, TEXT_CAP) }
    })

  const edge = (m: Message) => ({ sender: m.sender, text: m.text.slice(0, EDGE_CAP), ts: m.ts })
  const firstMessages = texts.slice(0, EDGE_COUNT).map(edge)
  const lastMessages = texts.slice(-EDGE_COUNT).map(edge)

  // laughs and the record, from text messages only
  const laughCounts = new Map<string, number>()
  let laughRecord = { sender: '', length: 0 }
  const considerLaugh = (sender: string, length: number) => {
    if (length > laughRecord.length) laughRecord = { sender, length }
  }
  for (const m of texts) {
    let count = 0
    for (const raw of m.text.split(/\s+/)) {
      const word = trimEdges(raw).toLowerCase()
      if (isLaughWord(word)) {
        count++
        considerLaugh(m.sender, Array.from(word).length)
      }
    }
    for (const g of emojiGraphemes(m.text)) {
      if (LAUGH_EMOJI.has(g)) {
        count++
        considerLaugh(m.sender, 1)
      }
    }
    if (count > 0) laughCounts.set(m.sender, (laughCounts.get(m.sender) ?? 0) + count)
  }
  const laughs: Record<string, number> = Object.create(null)
  for (const [sender, n] of laughCounts) laughs[sender] = n

  // most used words: letters only, >= 3 letters, not a stop word
  const wordCounts = new Map<string, number>()
  for (const m of texts) {
    for (const w of m.text.replace(/https?:\/\/\S+|www\.\S+/gi, ' ').toLowerCase().match(/\p{L}+/gu) ?? []) {
      if (w.length < 3 || STOP_WORDS.has(w)) continue
      wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1)
    }
  }

  const addresses = new Map<string, Map<string, number>>()
  for (const m of texts) {
    for (const token of m.text.toLowerCase().match(/\p{L}+/gu) ?? []) {
      if (!ADDRESS_TERMS.has(token)) continue
      let counts = addresses.get(m.sender)
      if (!counts) { counts = new Map(); addresses.set(m.sender, counts) }
      counts.set(token, (counts.get(token) ?? 0) + 1)
    }
  }
  const addressTerms = [...addresses].map(([sender, counts]) => {
    const [term, count] = topEntries(counts, 1)[0]
    return { sender, term, count }
  })

  const emojiCounts = new Map<string, number>()
  for (const m of texts) {
    for (const e of emojiGraphemes(m.text)) emojiCounts.set(e, (emojiCounts.get(e) ?? 0) + 1)
  }

  return {
    calendar,
    streak: streakOf(calendar),
    longestMessages,
    firstMessages,
    lastMessages,
    laughs,
    laughRecord,
    addressTerms,
    topWords: topEntries(wordCounts, TOP_WORDS),
    topEmojis: topEntries(emojiCounts, TOP_EMOJIS),
  }
}
