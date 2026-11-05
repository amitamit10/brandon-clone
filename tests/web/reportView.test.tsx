import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ReportView, parseAuraScore } from '../../web/components/ReportView'
import { REPORT_TAGLINES } from '../../web/lib/personas'
import { reportContent } from './fixtures'

afterEach(cleanup)

describe('ReportView', () => {
  it('renders the serif title, the persona tagline, and every section', () => {
    const { container } = render(<ReportView report={reportContent} persona="brandon" />)
    const title = screen.getByRole('heading', { level: 1, name: reportContent.title })
    expect(title.classList.contains('display-serif')).toBe(true)
    expect(screen.getByText(REPORT_TAGLINES.brandon)).toBeTruthy()
    expect(screen.getByText('Your chat stays under your control. Delete it any time.')).toBeTruthy()

    expect(screen.getByRole('heading', { name: /Who talks/ })).toBeTruthy()
    expect(container.querySelector('.report-section strong')?.textContent).toBe('Ana')
    expect(screen.getByRole('heading', { name: 'Running jokes' })).toBeTruthy()
    expect(screen.getByText('the Friday plan')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'What to do next' })).toBeTruthy()
  })

  it('shows real quotes as blockquotes, both in the verdict and on a member', () => {
    const { container } = render(<ReportView report={reportContent} persona="clara" />)
    const quotes = Array.from(container.querySelectorAll('blockquote')).map((q) => q.textContent)
    expect(quotes).toEqual(['hello there', 'still here'])
    expect(screen.getByText(REPORT_TAGLINES.clara)).toBeTruthy()
  })

  it('shows names as text: markup in a name is never rendered as an element', () => {
    const { container } = render(<ReportView report={reportContent} persona="diego" />)
    expect(screen.getByRole('heading', { level: 3, name: '<b>Eve</b>' })).toBeTruthy()
    expect(container.querySelector('b')).toBeNull()
  })

  it('renders model text through SafeText, so markup and links stay literal', () => {
    const report = { ...reportContent, advice: '<img src=x onerror=1> and [a](http://evil)' }
    const { container } = render(<ReportView report={report} persona="brandon" />)
    expect(container.querySelector('.report-body img')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
    expect(screen.getByText('<img src=x onerror=1> and [a](http://evil)')).toBeTruthy()
  })

  it('puts the optional actions slot and deep-dive control next to the content', () => {
    render(
      <ReportView
        report={reportContent}
        persona="brandon"
        actions={<button type="button">Share the report</button>}
        memberAction={(name) => <button type="button">Deep dive on {name}</button>}
      />,
    )
    expect(screen.getByRole('button', { name: 'Share the report' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Deep dive on Ana' })).toBeTruthy()
  })

  it('leaves out empty optional sections', () => {
    render(<ReportView report={{ ...reportContent, dynamic: '', shiftWeekNote: '', runningJokes: [] }} persona="brandon" />)
    expect(screen.queryByRole('heading', { name: 'The group dynamic' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'The week things changed' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Running jokes' })).toBeNull()
  })

  it('renders member aura meter with score, status, peak and loss quotes', () => {
    const reportWithAura = {
      ...reportContent,
      members: [
        {
          name: 'Ana',
          nickname: 'The Starter',
          opinion: 'Relentless.',
          aura: {
            score: '+75,000',
            status: 'טונות של אורה',
            peak: { points: '+25,000', reason: 'smooth exit', quote: 'hello there' },
            loss: { points: '-10,000', reason: 'voice note spam', quote: 'still here' },
          },
        },
      ],
    }
    const { container } = render(<ReportView report={reportWithAura} persona="brandon" />)
    expect(screen.getByText('+75,000')).toBeTruthy()
    expect(screen.getByText('טונות של אורה')).toBeTruthy()
    expect(screen.getByText('+25,000')).toBeTruthy()
    expect(screen.getByText('-10,000')).toBeTruthy()
    expect(container.querySelector('.aura-meter-card')).toBeTruthy()
  })

  it('parses aura scores accurately including infinities and negatives', () => {
    expect(parseAuraScore('+75,000')).toBe(75000)
    expect(parseAuraScore('-10,000')).toBe(-10000)
    expect(parseAuraScore('+אינסוף אורה')).toBe(999999)
    expect(parseAuraScore('+Infinity aura')).toBe(999999)
    expect(parseAuraScore(undefined)).toBe(0)
    expect(parseAuraScore('no number')).toBe(0)
  })

  it('renders aura podium with top places and debtor card when multiple members have aura', () => {
    const reportWithMultipleAura = {
      ...reportContent,
      members: [
        {
          name: 'Dana',
          nickname: 'The Debtor',
          opinion: 'Negative vibe.',
          aura: {
            score: '-50,000',
            status: 'פשיטת רגל של אורה',
          },
        },
        {
          name: 'Ana',
          nickname: 'The Queen',
          opinion: 'Maximum presence.',
          aura: {
            score: '+100,000',
            status: 'אדון האורה',
          },
        },
        {
          name: 'Ben',
          nickname: 'The Cool',
          opinion: 'Steady.',
          aura: {
            score: '+50,000',
            status: 'טונות של אורה',
          },
        },
        {
          name: 'Charlie',
          nickname: 'Quiet',
          opinion: 'Okay.',
          aura: {
            score: '+10,000',
            status: 'אורה חיובית',
          },
        },
      ],
    }

    const { container } = render(<ReportView report={reportWithMultipleAura} persona="brandon" />)

    // Check podium card is rendered
    expect(container.querySelector('.aura-podium-card')).toBeTruthy()

    // 1st place should be Ana
    const col1 = container.querySelector('.podium-1')
    expect(col1?.textContent).toContain('Ana')
    expect(col1?.textContent).toContain('+100,000')

    // 2nd place should be Ben
    const col2 = container.querySelector('.podium-2')
    expect(col2?.textContent).toContain('Ben')
    expect(col2?.textContent).toContain('+50,000')

    // 3rd place should be Charlie
    const col3 = container.querySelector('.podium-3')
    expect(col3?.textContent).toContain('Charlie')
    expect(col3?.textContent).toContain('+10,000')

    // Debtor should be Dana
    const debtor = container.querySelector('.podium-debtor-row')
    expect(debtor?.textContent).toContain('Dana')
    expect(debtor?.textContent).toContain('-50,000')
  })
})
