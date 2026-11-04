import { describe, expect, it } from 'vitest'
import { generateReport, verifyQuotes } from '../../src/pipeline/report'
import { PERSONAS } from '../../src/pipeline/personas'
import type { LlmProvider, LlmRequest } from '../../src/llm/provider'
import { computeStats } from '../../src/stats/compute'
import type { GroupReport, ParsedChat } from '../../src/shared/types'
import { statsChat } from '../fixtures/stats-chat'

const validGroup = {
  title: 'The official report',
  intro: 'You lot wrote 10 messages over 2 days.',
  verdict: 'Chaotic but loyal.',
  dynamic: 'Ana starts most things.',
  shiftWeekNote: 'Nothing shifted.',
  runningJokes: ['back 👍🏽'],
  sections: [{ emoji: '📊', heading: 'The numbers', body: 'Ana wrote 5 messages.\n> good morning all\n> never said this' }],
  members: [{ name: 'Ana', nickname: 'The Starter', opinion: 'Relentless.', quote: 'good morning all' }],
  advice: 'Mute the group, then come back.',
}

function fake(reply: string | ((req: LlmRequest) => string)) {
  const calls: LlmRequest[] = []
  const p: LlmProvider = {
    name: 'fake',
    async generate(req) {
      calls.push(req)
      return { text: typeof reply === 'string' ? reply : reply(req) }
    },
  }
  return { p, calls }
}

const stats = computeStats(statsChat)
const base = { language: 'English', me: 'Ana', stats, summaries: [], kind: 'group' as const }

describe('generateReport', () => {
  it('generateReport puts exact stats numbers (starters, busiest day) into the prompt', async () => {
    const { p, calls } = fake(JSON.stringify(validGroup))
    await generateReport(p, { ...base, persona: 'brandon' })
    const prompt = calls[calls.length - 1].prompt
    expect(prompt).toContain(`${stats.total} messages`)
    expect(prompt).toContain(`busiest day: ${stats.busiestDay.date} (${stats.busiestDay.count} messages)`)
    expect(prompt).toContain(`Cy: ${stats.perMember.Cy.messages} messages`)
    expect(prompt).toContain(`${stats.perMember.Cy.starters} conversation starters`)
  })

  it('report language is passed through', async () => {
    const { p, calls } = fake(JSON.stringify(validGroup))
    await generateReport(p, { ...base, persona: 'clara', language: 'Hebrew' })
    expect(calls[calls.length - 1].prompt).toContain('Hebrew')
  })

  it('uses the chosen persona system prompt', async () => {
    const { p, calls } = fake(JSON.stringify(validGroup))
    await generateReport(p, { ...base, persona: 'diego' })
    expect(calls[calls.length - 1].system).toBe(PERSONAS.diego.system)
  })

  it('rejects a member report whose members omit the subject', async () => {
    const { p } = fake(JSON.stringify({ ...validGroup, members: [{ name: 'Ben', nickname: 'x', opinion: 'y' }] }))
    await expect(
      generateReport(p, { ...base, persona: 'brandon', kind: 'member', subject: 'Ana' }),
    ).rejects.toThrow('llm_invalid_json')
  })

  it('rejects a group report with a wrongly typed field', async () => {
    const { p } = fake(JSON.stringify({ ...validGroup, sections: 'nope' }))
    await expect(generateReport(p, { ...base, persona: 'brandon' })).rejects.toThrow('llm_invalid_json')
  })

  it('a followup report carries the answer in sections and verdict', async () => {
    const reply = JSON.stringify({
      verdict: 'Ana, mostly.',
      sections: [{ emoji: '🔎', heading: 'Answer', body: 'Yes.' }],
    })
    const { p, calls } = fake(reply)
    const r = await generateReport(p, {
      ...base,
      persona: 'brandon',
      kind: 'followup',
      question: 'Who starts?',
      retrieved: ['09:00 Ana: good morning all'],
    })
    expect(r.verdict).toBe('Ana, mostly.')
    expect(r.sections[0].body).toBe('Yes.')
    expect(calls[calls.length - 1].prompt).toContain('Who starts?')
    expect(calls[calls.length - 1].prompt).toContain('good morning all')
  })
})

describe('verifyQuotes', () => {
  const chat: ParsedChat = {
    messages: [
      { id: 0, ts: 0, sender: 'Ana', text: 'Good   morning ALL', kind: 'text', edited: false },
      { id: 1, ts: 1, sender: 'Ben', text: 'see you‎ later', kind: 'text', edited: false },
      { id: 2, ts: 2, sender: 'Ben', text: 'ok then', kind: 'text', edited: false },
    ],
    participants: ['Ana', 'Ben'],
    systemEvents: [],
    format: 'android',
    dateOrder: 'mdy',
  }

  it('verifyQuotes keeps a quote that is a substring (case/whitespace/bidi-normalised) and drops a made-up one', () => {
    const out = verifyQuotes(validGroup as GroupReport, chat)
    expect(out.members[0].quote).toBe('good morning all')
    expect(out.sections[0].body).toContain('> good morning all')
    expect(out.sections[0].body).not.toContain('never said this')
  })

  it('verifyQuotes drops a quote that spans two messages', () => {
    const r = { ...validGroup, members: [{ name: 'Ana', nickname: 'n', opinion: 'o', quote: 'all see you' }] }
    const out = verifyQuotes(r as GroupReport, chat)
    expect(out.members[0].quote).toBeUndefined()
  })

  it('verifyQuotes does not mutate its input', () => {
    const input = structuredClone(validGroup) as GroupReport
    verifyQuotes(input, chat)
    expect(input.sections[0].body).toContain('never said this')
  })
})
