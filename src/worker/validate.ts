import type { ChatStats, Chunk, MemberStats } from '../shared/types'

/** An error that maps to an HTTP status and a short code. Never carries provider internals. */
export class ApiError extends Error {
  constructor(
    public status: 400 | 404 | 413 | 422 | 429 | 503,
    public code: string,
  ) {
    super(code)
    this.name = 'ApiError'
  }
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const MAX_TS = 1e15
const MAX_COUNT = 1e9
const MAX_CHUNKS = 400
const MAX_CHUNK_CHARS = 60_000
const MAX_PARTICIPANTS = 100
const MAX_NAME_CHARS = 80
const MIN_TOTAL_MESSAGES = 30
const DATE_RE = /^(\d{4}-\d{2}-\d{2})?$/

export interface ValidUpload {
  name: string
  participants: string[]
  stats: ChatStats
  chunks: Chunk[]
}

const bad = () => new ApiError(400, 'bad_request')
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

function num(x: unknown, min: number, max: number): number {
  if (typeof x !== 'number' || !Number.isFinite(x) || x < min || x > max) throw bad()
  return x
}
const int = (x: unknown, min: number, max: number): number => {
  const n = num(x, min, max)
  if (!Number.isInteger(n)) throw bad()
  return n
}
function str(x: unknown, min: number, max: number): string {
  if (typeof x !== 'string' || x.length < min || x.length > max) throw bad()
  return x
}
function list(x: unknown, min: number, max: number): unknown[] {
  if (!Array.isArray(x) || x.length < min || x.length > max) throw bad()
  return x
}
function record(x: unknown): Record<string, unknown> {
  if (!isRecord(x)) throw bad()
  return x
}
function dateString(x: unknown): string {
  const s = str(x, 0, 10)
  if (!DATE_RE.test(s)) throw bad()
  return s
}

function memberStats(x: unknown): MemberStats {
  const m = record(x)
  const topEmojis = list(m.topEmojis, 0, 10).map((pair): [string, number] => {
    if (!Array.isArray(pair) || pair.length !== 2) throw bad()
    return [str(pair[0], 1, 32), int(pair[1], 0, MAX_COUNT)]
  })
  return {
    messages: int(m.messages, 0, MAX_COUNT),
    words: int(m.words, 0, MAX_COUNT),
    media: int(m.media, 0, MAX_COUNT),
    deleted: int(m.deleted, 0, MAX_COUNT),
    edited: int(m.edited, 0, MAX_COUNT),
    starters: int(m.starters, 0, MAX_COUNT),
    topEmojis,
    avgReplyMs: m.avgReplyMs === null ? null : num(m.avgReplyMs, 0, MAX_TS),
    busiestHour: int(m.busiestHour, 0, 23),
  }
}

/**
 * Rebuilds the stats from validated fields only. Any extra key the client sent is dropped, and
 * perMember is a fresh null-prototype record whose keys must all be participants.
 */
function chatStats(raw: unknown, participants: Set<string>): ChatStats {
  const s = record(raw)
  const perRaw = record(s.perMember)
  const perMember: Record<string, MemberStats> = Object.create(null)
  for (const key of Object.keys(perRaw)) {
    if (!participants.has(key)) throw bad()
    perMember[key] = memberStats(perRaw[key])
  }
  const histogram = (x: unknown, n: number) => list(x, n, n).map((v) => int(v, 0, MAX_COUNT))
  const busy = record(s.busiestDay)
  const silence = record(s.longestSilence)
  let shiftWeek: ChatStats['shiftWeek'] = null
  if (s.shiftWeek !== null) {
    const w = record(s.shiftWeek)
    shiftWeek = { weekStart: dateString(w.weekStart), ratio: num(w.ratio, 0, 1e6) }
  }
  return {
    firstTs: num(s.firstTs, 0, MAX_TS),
    lastTs: num(s.lastTs, 0, MAX_TS),
    days: int(s.days, 0, 1e7),
    total: int(s.total, 0, MAX_COUNT),
    perMember,
    hourHistogram: histogram(s.hourHistogram, 24),
    weekdayHistogram: histogram(s.weekdayHistogram, 7),
    busiestDay: { date: dateString(busy.date), count: int(busy.count, 0, MAX_COUNT) },
    longestSilence: { fromTs: num(silence.fromTs, 0, MAX_TS), toTs: num(silence.toTs, 0, MAX_TS) },
    shiftWeek,
  }
}

/**
 * Validates the browser's upload. Shape errors are 400 bad_request. A chat that is too small
 * (fewer than 2 participants, or fewer than 30 messages) is 422 too_small, and no model call is made.
 */
export function validateUpload(input: unknown): ValidUpload {
  const body = record(input)
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (name.length < 1 || name.length > MAX_NAME_CHARS) throw bad()

  const participants = list(body.participants, 1, MAX_PARTICIPANTS).map((p) => str(p, 1, MAX_NAME_CHARS))
  const participantSet = new Set(participants)
  if (participantSet.size !== participants.length) throw bad()

  const chunks = list(body.chunks, 1, MAX_CHUNKS).map((c, i): Chunk => {
    const ch = record(c)
    const index = int(ch.index, 0, MAX_CHUNKS - 1)
    if (index !== i) throw bad()
    const fromId = int(ch.fromId, 0, MAX_COUNT)
    const toId = int(ch.toId, 0, MAX_COUNT)
    if (fromId > toId) throw bad()
    return { index, fromId, toId, text: str(ch.text, 1, MAX_CHUNK_CHARS) }
  })

  const stats = chatStats(body.stats, participantSet)
  if (participants.length < 2 || stats.total < MIN_TOTAL_MESSAGES) throw new ApiError(422, 'too_small')
  return { name, participants, stats, chunks }
}
