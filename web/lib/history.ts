import type { PersonaId } from '../../src/shared/types'

/**
 * Ids, names and the reader's own settings only. Chat text is never stored in the browser.
 * `me` is a participant's display name and is kept so follow-up and deep-dive reports can be made
 * after a reload (the server needs it, and the report response does not include it).
 */
export interface HistoryEntry {
  chatId: string
  reportId: string
  name: string
  createdAt: number
  persona?: PersonaId
  language?: string
  me?: string
  kind?: 'group' | 'member' | 'followup'
  subject?: string
}

export const HISTORY_KEY = 'brandon.history'
const MAX_ENTRIES = 50
const PERSONAS: ReadonlySet<string> = new Set(['brandon', 'clara', 'diego'])

function isEntry(x: unknown): x is HistoryEntry {
  if (typeof x !== 'object' || x === null) return false
  const e = x as Record<string, unknown>
  return (
    typeof e.chatId === 'string' &&
    typeof e.reportId === 'string' &&
    typeof e.name === 'string' &&
    typeof e.createdAt === 'number'
  )
}

/** Keeps the known fields only, so a corrupt or tampered entry cannot leak other values into the UI. */
function clean(e: HistoryEntry): HistoryEntry {
  const out: HistoryEntry = { chatId: e.chatId, reportId: e.reportId, name: e.name, createdAt: e.createdAt }
  if (typeof e.persona === 'string' && PERSONAS.has(e.persona)) out.persona = e.persona as PersonaId
  if (typeof e.language === 'string') out.language = e.language
  if (typeof e.me === 'string') out.me = e.me
  if (e.kind === 'group' || e.kind === 'member' || e.kind === 'followup') out.kind = e.kind
  if (typeof e.subject === 'string') out.subject = e.subject
  return out
}

/** Every storage access is guarded: private windows and blocked storage must not break the app. */
export function readHistory(): HistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isEntry).map(clean) : []
  } catch {
    return []
  }
}

function writeHistory(entries: HistoryEntry[]): void {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
  } catch {
    // Storage is optional: the report still works without a history entry.
  }
}

/** Newest first. A report id that is already listed is replaced, not duplicated. */
export function addHistory(entry: HistoryEntry): void {
  writeHistory([clean(entry), ...readHistory().filter((e) => e.reportId !== entry.reportId)])
}

export function removeReport(reportId: string): void {
  writeHistory(readHistory().filter((e) => e.reportId !== reportId))
}

export function removeChat(chatId: string): void {
  writeHistory(readHistory().filter((e) => e.chatId !== chatId))
}

/** Entries for one chat, newest first. */
export function historyForChat(chatId: string): HistoryEntry[] {
  return readHistory().filter((e) => e.chatId === chatId)
}

/**
 * The reader's settings for a chat, from its newest entry that has them. Used when the in-memory
 * session is gone (reload, another tab) so follow-ups and retries still know who "me" is.
 */
export function settingsForChat(chatId: string): Pick<HistoryEntry, 'name' | 'me' | 'persona' | 'language'> | null {
  const entries = historyForChat(chatId)
  if (entries.length === 0) return null
  const withMe = entries.find((e) => e.me !== undefined)
  const newest = entries[0]
  return {
    name: newest.name,
    me: withMe?.me,
    persona: withMe?.persona ?? newest.persona,
    language: withMe?.language ?? newest.language,
  }
}
