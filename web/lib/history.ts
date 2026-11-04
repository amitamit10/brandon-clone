/** Ids only. Chat text is never stored in the browser. */
export interface HistoryEntry {
  chatId: string
  reportId: string
  name: string
  createdAt: number
}

export const HISTORY_KEY = 'brandon.history'
const MAX_ENTRIES = 50

/** Every storage access is guarded: private windows and blocked storage must not break the app. */
export function readHistory(): HistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : []
  } catch {
    return []
  }
}

export function addHistory(entry: HistoryEntry): void {
  try {
    const next = [entry, ...readHistory()].slice(0, MAX_ENTRIES)
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
  } catch {
    // Storage is optional: the report still works without a history entry.
  }
}
