import schema1 from '../../migrations/0001_init.sql?raw'
import schema2 from '../../migrations/0002_report_failures.sql?raw'
import schema3 from '../../migrations/0003_report_lease.sql?raw'
import schema4 from '../../migrations/0004_usage.sql?raw'
import schema5 from '../../migrations/0005_uploader_name.sql?raw'
import type { LlmProvider, LlmRequest } from '../../src/llm/provider'
import { chunkMessages } from '../../src/pipeline/chunk'
import { computeStats } from '../../src/stats/compute'
import type { ParsedChat } from '../../src/shared/types'

/** Applies every migration in order (test-only; production uses wrangler migrations). */
export async function applyMigrations(db: D1Database): Promise<void> {
  for (const sql of [schema1, schema2, schema3, schema4, schema5]) {
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    await db.batch(statements.map((s) => db.prepare(s)))
  }
}

export interface FakeProvider extends LlmProvider {
  calls: LlmRequest[]
}

/**
 * Scripted provider. `script(req, n)` gets the 1-based call number and returns the reply text,
 * or throws to simulate a failure. The default answers summaries and reports with valid JSON.
 */
export function fakeProvider(script: (req: LlmRequest, n: number) => string = defaultReply): FakeProvider {
  const calls: LlmRequest[] = []
  return {
    name: 'fake',
    calls,
    async generate(req) {
      calls.push(req)
      return { text: script(req, calls.length) }
    },
  }
}

export const isSummaryCall = (req: LlmRequest) => req.system.includes('summarise one slice')

export const SUMMARY_JSON = JSON.stringify({ events: ['they talked'], jokes: ['a joke'], memberNotes: {}, quotes: ['hello there'] })

/** A full group report. The quotes include one real chat line and one invented one. */
export function reportJson(overrides: { memberName?: string } = {}): string {
  return JSON.stringify({
    title: 'The report',
    intro: 'Intro with 40 messages.',
    verdict: '',
    dynamic: 'Dynamic.',
    shiftWeekNote: 'No shift.',
    runningJokes: [],
    sections: [
      { emoji: '📊', heading: 'Numbers', body: 'They talk.\n\n> hello there\n\n> a quote that is invented\n\nDone.' },
    ],
    members: [
      { name: overrides.memberName ?? 'Ana', nickname: 'A', opinion: 'Talks a lot.', quote: 'hello there' },
      { name: 'Ben', nickname: 'B', opinion: 'Also talks.', quote: 'an invented quote from nowhere' },
    ],
    advice: 'Keep going.',
  })
}

export function defaultReply(req: LlmRequest): string {
  return isSummaryCall(req) ? SUMMARY_JSON : reportJson()
}

/** A chat with n messages alternating between the given senders, text 'hello there'. */
export function chatWith(n: number, senders: string[] = ['Ana', 'Ben']): ParsedChat {
  const base = Date.UTC(2025, 7, 1, 9, 0)
  return {
    messages: Array.from({ length: n }, (_, id) => ({
      id,
      ts: base + id * 60_000,
      sender: senders[id % senders.length],
      text: 'hello there',
      kind: 'text' as const,
      edited: false,
    })),
    participants: [...new Set(senders)],
    systemEvents: [],
    format: 'android',
    dateOrder: 'mdy',
  }
}

/** The JSON body the browser sends to POST /api/chats, built with the real stats and chunker. */
export function uploadBody(chat: ParsedChat, maxChars = 24_000, name = 'Test group') {
  return {
    name,
    uploaderName: 'Test User',
    participants: chat.participants,
    stats: computeStats(chat),
    chunks: chunkMessages(chat, maxChars),
  }
}
