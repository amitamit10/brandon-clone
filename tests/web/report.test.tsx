import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { Report } from '../../web/pages/Report'
import { clearSession, setSession } from '../../web/lib/session'
import { addHistory, HISTORY_KEY } from '../../web/lib/history'
import { INITIAL_JOB, type ReportJob } from '../../web/lib/useReportJob'
import { doneView, jsonResponse, reportContent, sessionFixture } from './fixtures'

// The job hook is replaced so each test drives the job state directly and deterministically.
const hook = vi.hoisted(() => ({ job: { status: 'running', phase: '', progress: 0, total: 0, error: null } as ReportJob }))
vi.mock('../../web/lib/useReportJob', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../web/lib/useReportJob')>()),
  useReportJob: () => hook.job,
}))

function LocationProbe() {
  const location = useLocation()
  return <p data-testid="loc">{`${location.pathname}${location.search}`}</p>
}

function page(path: string) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route path="/c/:chatId/reports/:reportId" element={<Report />} />
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>
  )
}

function stubFetch(handler: (url: string, init: RequestInit) => unknown) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = handler(url, init ?? {})
    return body instanceof Response ? body : jsonResponse(200, body)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const setJob = (job: Partial<ReportJob>) => {
  hook.job = { ...INITIAL_JOB, ...job }
}

beforeEach(() => {
  clearSession()
  window.localStorage.clear()
  setJob({})
})

afterEach(() => {
  cleanup()
  clearSession()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('report route state machine', () => {
  it('shows reading, then the story, then thinking, then the report, in that order', async () => {
    const user = userEvent.setup()
    setSession(sessionFixture())
    stubFetch((url) => (url === '/api/reports/rep-1' ? doneView() : {}))

    const view = render(page('/c/c1/reports/rep-1'))
    setJob({ status: 'running', phase: 'summarizing', progress: 1, total: 3 })
    view.rerender(page('/c/c1/reports/rep-1'))
    // 1 of 2 chunks read: half of the 6 messages.
    expect(screen.getByText(/of 6 messages/)).toBeTruthy()
    expect(screen.queryByText('Your years, day by day')).toBeNull()

    setJob({ status: 'running', phase: 'reporting', progress: 2, total: 3 })
    view.rerender(page('/c/c1/reports/rep-1'))
    expect(screen.getByRole('heading', { name: 'Your years, day by day' })).toBeTruthy()
    expect(screen.getByText('1 of 7')).toBeTruthy()

    for (let card = 2; card <= 7; card++) {
      // Cards 1 to 6 end with Continue; card 7 ends with See the report.
      await user.click(screen.getByRole('button', { name: 'Continue' }))
      expect(screen.getByText(`${card} of 7`)).toBeTruthy()
    }
    await user.click(screen.getByRole('button', { name: 'See the report' }))

    // Still writing: the thinking screen, with the persona name and a part caption.
    expect(screen.getByText('Brandon is thinking…')).toBeTruthy()
    expect(screen.getByText('Writing the report')).toBeTruthy()

    setJob({ status: 'done', phase: 'done', progress: 3, total: 3 })
    view.rerender(page('/c/c1/reports/rep-1'))
    expect(await screen.findByRole('heading', { level: 1, name: reportContent.title })).toBeTruthy()
  })

  it('skips reading and the story when the session is for another chat', async () => {
    stubFetch((url) => (url === '/api/reports/rep-1' ? doneView() : {}))
    setSession(sessionFixture({ chatId: 'other' }))
    const view = render(page('/c/c1/reports/rep-1'))
    setJob({ status: 'running', phase: 'summarizing', progress: 1, total: 3 })
    view.rerender(page('/c/c1/reports/rep-1'))

    expect(screen.getByText('Brandon is thinking…')).toBeTruthy()
    expect(screen.queryByText(/messages$/)).toBeNull()
    setJob({ status: 'done', phase: 'done', progress: 3, total: 3 })
    view.rerender(page('/c/c1/reports/rep-1'))
    expect(await screen.findByRole('heading', { level: 1, name: reportContent.title })).toBeTruthy()
  })

  it('without a session (reload) goes straight to thinking, then the report', async () => {
    stubFetch((url) => (url === '/api/reports/rep-1' ? doneView() : {}))
    setJob({ status: 'running', phase: 'summarizing', progress: 0, total: 3 })
    const view = render(page('/c/c1/reports/rep-1'))
    expect(screen.getByText('Brandon is thinking…')).toBeTruthy()

    setJob({ status: 'done', phase: 'done', progress: 3, total: 3 })
    view.rerender(page('/c/c1/reports/rep-1'))
    expect(await screen.findByRole('heading', { level: 1, name: reportContent.title })).toBeTruthy()
  })

  it('shows a plain failure with Try again, which creates a new report with the same settings', async () => {
    const user = userEvent.setup()
    setSession(sessionFixture())
    const fetchMock = stubFetch((url) => (url === '/api/chats/c1/reports' ? { reportId: 'rep-2' } : {}))
    setJob({ status: 'failed', phase: 'failed', progress: 1, total: 3, error: 'llm_error' })
    render(page('/c/c1/reports/rep-1'))

    expect(screen.getByText('Report stopped')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/c/c1/reports/rep-2'))
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/chats/c1/reports')
    expect(JSON.parse(init.body as string)).toEqual({ persona: 'brandon', language: 'English', me: 'Ana', kind: 'group' })
  })

  it('a failed job without a session offers no retry, only a way back to the chat', () => {
    setJob({ status: 'failed', phase: 'failed', progress: 1, total: 3, error: 'llm_error' })
    render(page('/c/c1/reports/rep-1'))
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to the chat' })).toBeTruthy()
  })

  it('shows the report with share, follow-up and delete controls on the private page', async () => {
    stubFetch((url) => (url === '/api/reports/rep-1' ? doneView() : {}))
    setJob({ status: 'done', phase: 'done', progress: 3, total: 3 })
    window.localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify([{ chatId: 'c1', reportId: 'rep-1', name: 'The Boys', createdAt: 1, me: 'Ana', persona: 'brandon', language: 'English' }]),
    )
    render(page('/c/c1/reports/rep-1'))

    expect(await screen.findByRole('heading', { level: 1, name: reportContent.title })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Share the report' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Ask a deeper question' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete this report' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Deep dive on Ana' })).toBeTruthy()
  })

  it('a stored report without the reader settings hides the follow-up and delete controls', async () => {
    stubFetch((url) => (url === '/api/reports/rep-1' ? doneView() : {}))
    setJob({ status: 'done', phase: 'done', progress: 3, total: 3 })
    render(page('/c/c1/reports/rep-1'))
    expect(await screen.findByRole('heading', { level: 1, name: reportContent.title })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Ask a deeper question' })).toBeNull()
    expect(screen.getByText(/Start a new report from the chat page/)).toBeTruthy()
  })
})

describe('share, follow-up, deep dive and delete on the private report', () => {
  function renderDone(extraStorage = true) {
    if (extraStorage) {
      window.localStorage.setItem(
        HISTORY_KEY,
        JSON.stringify([{ chatId: 'c1', reportId: 'rep-1', name: 'The Boys', createdAt: 1, me: 'Ana', persona: 'brandon', language: 'English' }]),
      )
    }
    setJob({ status: 'done', phase: 'done', progress: 3, total: 3 })
    return render(page('/c/c1/reports/rep-1'))
  }

  it('creates a share link, copies it with feedback, and stops sharing', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    const fetchMock = stubFetch((url, init) => {
      if (url === '/api/reports/rep-1') return doneView()
      if (url === '/api/reports/rep-1/share' && init.method === 'POST') return { shareId: 'abc123' }
      if (url === '/api/reports/rep-1/share' && init.method === 'DELETE') return { ok: true }
      return {}
    })
    renderDone()

    await user.click(await screen.findByRole('button', { name: 'Share the report' }))
    expect(await screen.findByText(`${window.location.origin}/s/abc123`)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/s/abc123`)
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Stop sharing' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Share the report' })).toBeTruthy())
    const methods = fetchMock.mock.calls.map((c) => `${(c as unknown as [string, RequestInit])[1]?.method ?? 'GET'} ${(c as unknown as [string])[0]}`)
    expect(methods).toContain('DELETE /api/reports/rep-1/share')
  })

  it('reports a failed copy in plain words', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) } })
    stubFetch((url, init) => {
      if (url === '/api/reports/rep-1') return doneView()
      if (init.method === 'POST') return { shareId: 'zz' }
      return { ok: true }
    })
    renderDone()
    await user.click(await screen.findByRole('button', { name: 'Share the report' }))
    await user.click(await screen.findByRole('button', { name: 'Copy link' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Copying did not work/)
  })

  it('the follow-up box posts the right JSON and navigates to the new report', async () => {
    const user = userEvent.setup()
    const fetchMock = stubFetch((url) => {
      if (url === '/api/reports/rep-1') return doneView()
      if (url === '/api/chats/c1/reports') return { reportId: 'rep-9' }
      return {}
    })
    renderDone()

    const input = await screen.findByPlaceholderText('Who always has the last word?')
    await user.type(input, '  Who owes who?  ')
    expect(screen.getByText('17/500')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Ask Brandon' }))
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/c/c1/reports/rep-9'))

    const post = fetchMock.mock.calls.find((c) => (c as unknown as [string])[0] === '/api/chats/c1/reports') as unknown as [string, RequestInit]
    expect(JSON.parse(post[1].body as string)).toEqual({
      persona: 'brandon',
      language: 'English',
      me: 'Ana',
      kind: 'followup',
      question: 'Who owes who?',
    })
  })

  it('the follow-up box refuses more than 500 characters', async () => {
    const user = userEvent.setup()
    stubFetch((url) => (url === '/api/reports/rep-1' ? doneView() : {}))
    renderDone()
    const input = await screen.findByPlaceholderText('Who always has the last word?')
    await user.click(input)
    await user.paste('x'.repeat(600))
    expect((input as HTMLTextAreaElement).value.length).toBe(500)
    expect(screen.getByText('500/500')).toBeTruthy()
  })

  it('a deep dive posts a member report with that member as subject, and only report members are offered', async () => {
    const user = userEvent.setup()
    const fetchMock = stubFetch((url) => {
      if (url === '/api/reports/rep-1') return doneView()
      if (url === '/api/chats/c1/reports') return { reportId: 'rep-7' }
      return {}
    })
    renderDone()

    // Only the report's own members get a deep dive: Ana and the (escaped) second member.
    expect(await screen.findAllByRole('button', { name: /^Deep dive on/ })).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Deep dive on Ana' }))
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/c/c1/reports/rep-7'))
    const post = fetchMock.mock.calls.find((c) => (c as unknown as [string])[0] === '/api/chats/c1/reports') as unknown as [string, RequestInit]
    expect(JSON.parse(post[1].body as string)).toEqual({
      persona: 'brandon',
      language: 'English',
      me: 'Ana',
      kind: 'member',
      subject: 'Ana',
    })
  })

  it('deleting a report asks first, then deletes on the server and goes back to the chat', async () => {
    const user = userEvent.setup()
    const fetchMock = stubFetch((url, init) => {
      if (url === '/api/reports/rep-1' && init.method === 'DELETE') return { ok: true }
      if (url === '/api/reports/rep-1') return doneView()
      return {}
    })
    renderDone()

    await user.click(await screen.findByRole('button', { name: 'Delete this report' }))
    expect(screen.getByText('Delete this report for good?')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(fetchMock.mock.calls.some((c) => (c as unknown as [string, RequestInit])[1]?.method === 'DELETE')).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Delete this report' }))
    await user.click(screen.getByRole('button', { name: 'Yes, delete report' }))
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/c/c1'))
    expect(JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? '[]')).toEqual([])
  })

  it('a 404 on delete is treated as already deleted', async () => {
    const user = userEvent.setup()
    stubFetch((url, init) => {
      if (url === '/api/reports/rep-1' && init.method === 'DELETE') return jsonResponse(404, { error: 'not_found' })
      if (url === '/api/reports/rep-1') return doneView()
      return {}
    })
    renderDone()
    await user.click(await screen.findByRole('button', { name: 'Delete this report' }))
    await user.click(screen.getByRole('button', { name: 'Yes, delete report' }))
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/c/c1'))
  })

  it('deleting the whole chat goes to history', async () => {
    const user = userEvent.setup()
    stubFetch((url, init) => {
      if (url === '/api/chats/c1' && init.method === 'DELETE') return { ok: true }
      if (url === '/api/reports/rep-1') return doneView()
      return {}
    })
    renderDone()
    await user.click(await screen.findByRole('button', { name: 'Delete the chat' }))
    await user.click(screen.getByRole('button', { name: 'Yes, delete chat' }))
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/history'))
  })
})
