import { I18nProvider } from '../../web/lib/i18n'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StoryCard } from '../../web/components/StoryCards'
import type { ChatExtras, ChatStats, MemberStats } from '../../src/shared/types'
import { calendarGrid, shareOfVoice, starters } from '../../web/lib/story'

afterEach(cleanup)

const DAY = 86_400_000
const jan1 = Date.parse('2025-01-01T00:00:00Z')

function member(messages: number, starters: number): MemberStats {
  return {
    messages,
    words: messages * 3,
    media: 0,
    deleted: 0,
    edited: 0,
    starters,
    topEmojis: [],
    avgReplyMs: null,
    busiestHour: 12,
  }
}

const hours = new Array<number>(24).fill(0)
hours[19] = 8
hours[23] = 2
hours[9] = 5

const stats: ChatStats = {
  firstTs: jan1,
  lastTs: jan1 + 3 * DAY,
  days: 4,
  total: 100,
  perMember: { Ana: member(60, 3), Ben: member(30, 1), Cy: member(10, 0) },
  hourHistogram: hours,
  weekdayHistogram: [0, 0, 0, 0, 0, 0, 0],
  busiestDay: { date: '2025-01-02', count: 40 },
  longestSilence: { fromTs: jan1, toTs: jan1 + 2 * DAY },
  shiftWeek: null,
}

const extras: ChatExtras = {
  calendar: [
    { date: '2025-01-01', count: 10 },
    { date: '2025-01-02', count: 40 },
    { date: '2025-01-03', count: 20 },
    { date: '2025-01-04', count: 30 },
  ],
  streak: { days: 4, fromDate: '2025-01-01', toDate: '2025-01-04' },
  longestMessages: [
    { sender: 'Ana', words: 120, ts: jan1, text: 'x'.repeat(300) },
  ],
  firstMessages: [{ sender: 'Ana', text: 'first hello', ts: jan1 }],
  lastMessages: [{ sender: 'Ben', text: 'last goodnight', ts: jan1 + 3 * DAY }],
  laughs: Object.assign(Object.create(null), { Ana: 5, Ben: 2 }),
  laughRecord: { sender: 'Ana', length: 9 },
  topWords: [['pizza', 7], ['plan', 4]],
  topEmojis: [['😂', 12]],
}

describe('story cards', () => {
  it('uses the last displayed message date rather than an unrelated maximum timestamp', () => {
    render(<StoryCard index={6} stats={{ ...stats, lastTs: jan1 + 10 * DAY }} extras={extras} />)
    expect(screen.getByText('Jan 4, 2025')).toBeTruthy()
  })

  it('card 1 draws one square per day across the month rows', () => {
    // Jan 30 to Feb 2 2025: January (31 days) and February (28 days) rows.
    const grid = calendarGrid(extras, Date.parse('2025-01-30T00:00:00Z'), Date.parse('2025-02-02T00:00:00Z'))
    expect(grid.months).toHaveLength(2)

    render(<StoryCard index={1} stats={{ ...stats, firstTs: Date.parse('2025-01-30T00:00:00Z'), lastTs: Date.parse('2025-02-02T00:00:00Z') }} extras={extras} />)
    const squares = document.querySelectorAll('.heat-cell:not(.heat-empty)')
    expect(squares).toHaveLength(31 + 28)
    expect(document.querySelectorAll('.heat-empty')).toHaveLength(3)
  })

  it('card 1 brightens busier days', () => {
    const grid = calendarGrid(extras, jan1, jan1 + 3 * DAY)
    const byDate = Object.fromEntries(grid.months[0].cells.filter(Boolean).map((c) => [c!.date, c!]))
    expect(byDate['2025-01-02'].level).toBe(4)
    expect(byDate['2025-01-01'].level).toBeLessThan(byDate['2025-01-02'].level)
    expect(byDate['2025-01-05'].count).toBe(0)
  })

  it('card 2 shows the share of voice as percentages', () => {
    render(<StoryCard index={2} stats={stats} extras={extras} />)
    const list = document.querySelector('.voice-list') as HTMLElement
    const rows = within(list).getAllByRole('listitem').map((li) => li.textContent)
    expect(rows).toEqual(['Ana60%', 'Ben30%', 'Cy10%'])
    expect(shareOfVoice(stats).map((r) => r.percent)).toEqual([60, 30, 10])
    expect(document.querySelector('svg.donut path')).not.toBeNull()
  })

  it('card 2 shares starters across people who started talks', () => {
    expect(starters(stats).map((r) => [r.name, r.percent])).toEqual([
      ['Ana', 75],
      ['Ben', 25],
      ['Cy', 0],
    ])
    render(<StoryCard index={2} stats={stats} extras={extras} />)
    expect(screen.getByText('Who starts the conversation')).toBeTruthy()
  })

  it('card 3 gives the streak, record day and peak hour', () => {
    render(<StoryCard index={3} stats={stats} extras={extras} />)
    expect(screen.getByText(/days in a row, Jan 1, 2025 to Jan 4, 2025/)).toBeTruthy()
    expect(screen.getByText('messages on Jan 2, 2025')).toBeTruthy()
    expect(screen.getByText('2 days')).toBeTruthy()
    expect(screen.getByText('2% from 10pm to midnight · peak at 19:00')).toBeTruthy()
    expect(document.querySelectorAll('.hour-bar')).toHaveLength(24)
  })

  it('card 4 truncates the longest message until See more is pressed', async () => {
    const user = userEvent.setup()
    render(<StoryCard index={4} stats={stats} extras={extras} />)
    const article = screen.getByText('Ana').closest('article') as HTMLElement
    expect(article.querySelector('.bubble-text')?.textContent?.endsWith('…')).toBe(true)

    await user.click(within(article).getByRole('button', { name: 'See more' }))
    expect(article.querySelector('.bubble-text')?.textContent).toBe('x'.repeat(300))
    expect(within(article).getByRole('button', { name: 'See less' })).toBeTruthy()
  })

  it('card 5 and 6 show the first and last messages with their dates', () => {
    const { unmount } = render(<StoryCard index={5} stats={stats} extras={extras} />)
    expect(screen.getByText('first hello')).toBeTruthy()
    expect(screen.getByText('Jan 1, 2025')).toBeTruthy()
    unmount()

    render(<StoryCard index={6} stats={stats} extras={extras} />)
    expect(screen.getByText('last goodnight')).toBeTruthy()
    expect(screen.getByText('Jan 4, 2025')).toBeTruthy()
  })

  it('card 7 prints laugh rows, the record, words and emojis', () => {
    render(<StoryCard index={7} stats={stats} extras={extras} />)
    const laughs = document.querySelector('.bars') as HTMLElement
    const rows = within(laughs).getAllByRole('listitem').map((li) => li.textContent)
    expect(rows).toEqual(['Ana5', 'Ben2'])
    expect(screen.getByText('Record: 9 letters in one laugh, by Ana.')).toBeTruthy()
    expect(screen.getByText('pizza')).toBeTruthy()
    expect(screen.getByText('😂')).toBeTruthy()
  })

  it('card 7 says so when nobody laughed', () => {
    render(<StoryCard index={7} stats={stats} extras={{ ...extras, laughs: Object.create(null), laughRecord: { sender: '', length: 0 } }} />)
    expect(screen.getByText('No laughs counted.')).toBeTruthy()
  })
})

describe('Hebrew rhythm', () => {
  it('counts Saturdays with no messages inside the conversation span', () => {
    localStorage.setItem('brandon_lang', 'he')
    // 2025-01-04 is a Saturday and is active; 2025-01-11 is quiet.
    render(<I18nProvider><StoryCard index={3} stats={{ ...stats, lastTs: jan1 + 10 * DAY }} extras={extras} /></I18nProvider>)
    expect(screen.getByText('1 מתוך 2 שבתות ללא הודעות')).toBeTruthy()
    localStorage.clear()
  })
})
