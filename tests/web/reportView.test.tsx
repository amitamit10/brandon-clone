import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ReportView } from '../../web/components/ReportView'
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
    expect(container.querySelector('img')).toBeNull()
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
})
