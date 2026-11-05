import { computeExtras } from '../../src/stats/extras'
import { computeStats } from '../../src/stats/compute'
import type { GroupReport, ParsedChat } from '../../src/shared/types'
import type { ChatSession } from '../../web/lib/session'

/** A small, hand-made chat. Ana is the reader ("me"). */
export const chat: ParsedChat = {
  messages: [
    { id: 1, ts: Date.parse('2025-01-01T10:00:00Z'), sender: 'Ana', text: 'hello there', kind: 'text', edited: false },
    { id: 2, ts: Date.parse('2025-01-01T10:05:00Z'), sender: 'Ben', text: 'hi Ana, lol', kind: 'text', edited: false },
    { id: 3, ts: Date.parse('2025-01-02T09:00:00Z'), sender: 'Ana', text: 'plan for friday? 😂😂', kind: 'text', edited: false },
    { id: 4, ts: Date.parse('2025-01-02T09:30:00Z'), sender: 'Ana', text: 'still here', kind: 'text', edited: false },
    { id: 5, ts: Date.parse('2025-01-03T20:00:00Z'), sender: 'Ben', text: 'Friday is off', kind: 'text', edited: false },
    { id: 6, ts: Date.parse('2025-01-03T20:01:00Z'), sender: 'Ben', text: 'goodnight all', kind: 'text', edited: false },
  ],
  participants: ['Ana', 'Ben'],
  systemEvents: [],
  format: 'android',
  dateOrder: 'mdy',
}

export function sessionFixture(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    chatId: 'c1',
    reportId: 'rep-1',
    groupName: 'The Boys',
    chat,
    stats: computeStats(chat),
    chunks: [],
    extras: computeExtras(chat),
    persona: 'brandon',
    language: 'English',
    me: 'Ana',
    ...overrides,
  }
}

export const reportContent: GroupReport = {
  title: 'Ana and Ben: the official report',
  intro: 'Two people, six messages, one plan that never happened.',
  verdict: 'Ana talks more.\n\n> hello there',
  dynamic: '',
  shiftWeekNote: '',
  runningJokes: ['the Friday plan'],
  sections: [{ emoji: '🍻', heading: 'Who talks', body: '**Ana** wins on volume.' }],
  members: [
    { name: 'Ana', nickname: 'Captain', opinion: 'Always has a plan.', quote: 'still here' },
    { name: '<b>Eve</b>', nickname: 'Ghost', opinion: 'Says nothing.' },
  ],
  advice: 'Pick a date.',
}

export function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

export function doneView(content: GroupReport = reportContent) {
  return { status: 'done', progress: 3, total: 3, persona: 'brandon', language: 'English', kind: 'group', subject: null, error: null, content }
}
