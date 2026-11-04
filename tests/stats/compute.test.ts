import { describe, expect, it } from 'vitest'
import { assertAnalyzable, computeStats } from '../../src/stats/compute'
import { ParseError } from '../../src/shared/types'
import { manyChat, statsChat, weeklyChat } from '../fixtures/stats-chat'

const at = (day: number, hh: number, mm: number) => Date.UTC(2025, 7, day, hh, mm)

describe('computeStats', () => {
  it('counts messages and words per member (words from text messages only)', () => {
    const s = computeStats(statsChat)
    expect(s.total).toBe(10)
    expect(s.perMember.Ana).toMatchObject({ messages: 5, words: 9, media: 1, deleted: 0, edited: 1 })
    expect(s.perMember.Ben).toMatchObject({ messages: 3, words: 4, media: 0, deleted: 1, edited: 0 })
    expect(s.perMember.Cy).toMatchObject({ messages: 2, words: 6, media: 0, deleted: 0, edited: 0 })
  })

  it('a starter is the first message of the chat or one after a gap >= 6h', () => {
    const s = computeStats(statsChat)
    // starters: Ana 09:00 (first message), Cy 16:00 (gap 6h53m), Cy Aug 2 10:00 (gap 17h20m)
    expect(s.perMember.Ana.starters).toBe(1)
    expect(s.perMember.Ben.starters).toBe(0)
    expect(s.perMember.Cy.starters).toBe(2)
  })

  it('conversationGapMs option changes what counts as a starter', () => {
    const s = computeStats(statsChat, { conversationGapMs: 20 * 60_000 })
    // Ana 16:30 (gap 30m) now also starts a conversation
    expect(s.perMember.Ana.starters).toBe(2)
    expect(s.perMember.Cy.starters).toBe(2)
  })

  it('busiest day and busiest hour (ties go to the lowest hour)', () => {
    const s = computeStats(statsChat)
    expect(s.busiestDay).toEqual({ date: '2025-08-01', count: 8 })
    expect(s.hourHistogram).toHaveLength(24)
    expect(s.hourHistogram[9]).toBe(4)
    expect(s.hourHistogram[10]).toBe(2)
    expect(s.hourHistogram[16]).toBe(4)
    expect(s.hourHistogram.reduce((a, b) => a + b, 0)).toBe(10)
    // Ana: 09h x2 and 16h x2 -> 9. Ben: 9. Cy: 16h x1 and 10h x1 -> 10.
    expect(s.perMember.Ana.busiestHour).toBe(9)
    expect(s.perMember.Ben.busiestHour).toBe(9)
    expect(s.perMember.Cy.busiestHour).toBe(10)
  })

  it('weekday histogram uses getUTCDay (index 0 = Sunday); Aug 1 2025 is a Friday', () => {
    const s = computeStats(statsChat)
    expect(s.weekdayHistogram).toEqual([0, 0, 0, 0, 0, 8, 2])
  })

  it('days is the inclusive calendar span, firstTs and lastTs are the bounds', () => {
    const s = computeStats(statsChat)
    expect(s.firstTs).toBe(at(1, 9, 0))
    expect(s.lastTs).toBe(at(2, 10, 2))
    expect(s.days).toBe(2)
  })

  it('longest silence is the largest gap between consecutive messages', () => {
    const s = computeStats(statsChat)
    expect(s.longestSilence).toEqual({ fromTs: at(1, 16, 40), toTs: at(2, 10, 0) })
  })

  it('avgReplyMs is the mean gap to the immediately preceding message from another sender, when < 6h', () => {
    const s = computeStats(statsChat)
    // Ana replies: 09:06 (after Ben 09:05, 1m), 16:30 (after Cy 16:00, 30m), Aug 2 10:02 (after Cy 10:00, 2m)
    expect(s.perMember.Ana.avgReplyMs).toBe((60_000 + 1_800_000 + 120_000) / 3)
    // Ben replies: 09:05 (5m), 09:07 (1m), 16:40 (9m)
    expect(s.perMember.Ben.avgReplyMs).toBe((300_000 + 60_000 + 540_000) / 3)
    // Cy's only replies are after gaps >= 6h, so no reply time
    expect(s.perMember.Cy.avgReplyMs).toBeNull()
  })

  it('topEmojis sorted by count; multi-codepoint emoji (skin tone, ZWJ family) count once each', () => {
    const s = computeStats(statsChat)
    expect(s.perMember.Cy.topEmojis).toEqual([
      ['👍🏽', 3],
      ['👨‍👩‍👧', 1],
    ])
    expect(s.perMember.Ben.topEmojis).toEqual([['☀️', 1]])
    expect(s.perMember.Ana.topEmojis).toEqual([])
  })

  it('shiftWeek is the week whose volume differs most from the mean of the 4 previous weeks', () => {
    // 10 messages every week, then a 10x spike in the last of 10 weeks (week of 2025-08-04)
    const s = computeStats(weeklyChat([10, 10, 10, 10, 10, 10, 10, 10, 10, 100]))
    expect(s.shiftWeek).toEqual({ weekStart: '2025-08-04', ratio: 10 })
  })

  it('shiftWeek is null for fewer than 8 weeks and considered for exactly 8', () => {
    expect(computeStats(weeklyChat([10, 10, 10, 10, 10, 10, 100])).shiftWeek).toBeNull()
    const eight = computeStats(weeklyChat([10, 10, 10, 10, 10, 10, 10, 100]))
    expect(eight.shiftWeek).toEqual({ weekStart: '2025-07-21', ratio: 10 })
  })
})

describe('assertAnalyzable', () => {
  const codeOf = (fn: () => void) => {
    try {
      fn()
      return null
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError)
      return (e as ParseError).code
    }
  }

  it('rejects 29 messages from two senders', () => {
    expect(codeOf(() => assertAnalyzable(manyChat(29, ['Ana', 'Ben'])))).toBe('too_small')
  })

  it('rejects 30 messages from a single sender', () => {
    expect(codeOf(() => assertAnalyzable(manyChat(30, ['Ana'])))).toBe('too_small')
  })

  it('accepts 30 messages from two senders', () => {
    expect(codeOf(() => assertAnalyzable(manyChat(30, ['Ana', 'Ben'])))).toBeNull()
  })
})
