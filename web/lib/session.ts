import type { ChatExtras, ChatStats, Chunk, ParsedChat, PersonaId } from '../../src/shared/types'

/**
 * What the browser still holds from the wizard for the chat it just analysed. It lets the report
 * route show the reading screen and the story. It lives in module memory only: it is never written to
 * localStorage, sessionStorage or IndexedDB, so a reload or another device simply skips those screens.
 */
export interface ChatSession {
  chatId: string
  reportId: string
  groupName: string
  /** renamed and merged, the same chat the stats were computed from */
  chat: ParsedChat
  stats: ChatStats
  chunks: Chunk[]
  extras: ChatExtras
  persona: PersonaId
  language: string
  me: string
}

let current: ChatSession | null = null

export function setSession(session: ChatSession): void {
  current = session
}

export function getSession(): ChatSession | null {
  return current
}

/** The session, but only when it belongs to this chat. */
export function sessionFor(chatId: string): ChatSession | null {
  return current !== null && current.chatId === chatId ? current : null
}

export function clearSession(): void {
  current = null
}
