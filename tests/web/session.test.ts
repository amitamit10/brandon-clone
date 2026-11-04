import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatStats, ParsedChat } from '../../src/shared/types'
import { clearSession, getSession, setSession, sessionFor, type ChatSession } from '../../web/lib/session'

const chat: ParsedChat = { messages: [], participants: ['Ana', 'Ben'], systemEvents: [], format: 'android', dateOrder: 'mdy' }

function session(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    chatId: 'chat-1',
    reportId: 'rep-1',
    groupName: 'The Boys',
    chat,
    stats: {} as ChatStats,
    chunks: [],
    extras: {
      calendar: [],
      streak: { days: 0, fromDate: '', toDate: '' },
      longestMessages: [],
      firstMessages: [],
      lastMessages: [],
      laughs: {},
      laughRecord: { sender: '', length: 0 },
      topWords: [],
      topEmojis: [],
    },
    persona: 'brandon',
    language: 'English',
    me: 'Ana',
    ...overrides,
  }
}

beforeEach(() => clearSession())
afterEach(() => {
  clearSession()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('session store', () => {
  it('holds the session in memory and only returns it for its own chat', () => {
    setSession(session())
    expect(getSession()?.groupName).toBe('The Boys')
    expect(sessionFor('chat-1')?.reportId).toBe('rep-1')
    expect(sessionFor('chat-2')).toBeNull()
    clearSession()
    expect(getSession()).toBeNull()
  })

  it('is never persisted to any browser storage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    setSession(session({ me: 'Secret Name' }))
    getSession()

    expect(setItem).not.toHaveBeenCalled()
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
    expect(JSON.stringify({ ...window.localStorage })).not.toContain('Secret Name')
  })

  it('does not reference any persistent storage API in its source', () => {
    const source = readFileSync(join(process.cwd(), 'web/lib/session.ts'), 'utf8')
    expect(source).not.toMatch(/(localStorage|sessionStorage|indexedDB|document\.cookie)\s*[.[]/)
  })
})
