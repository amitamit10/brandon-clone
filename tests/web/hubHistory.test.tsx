import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { Hub } from '../../web/pages/Hub'
import { History } from '../../web/pages/History'
import { HISTORY_KEY, readHistory } from '../../web/lib/history'
import { clearSession, setSession } from '../../web/lib/session'
import { doneView, jsonResponse, reportContent, sessionFixture } from './fixtures'

afterEach(() => {
  cleanup()
  clearSession()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

function LocationProbe() {
  return <p data-testid="loc">{useLocation().pathname}</p>
}

function renderAt(path: string, element: React.ReactNode, route: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route path={route} element={element} />
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>,
  )
}

const entry = (reportId: string, createdAt: number, extra: Record<string, unknown> = {}) => ({
  chatId: 'c1',
  reportId,
  name: 'The Boys',
  createdAt,
  persona: 'brandon',
  ...extra,
})

function storeHistory(entries: unknown[]) {
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries))
}

const notFound = () => jsonResponse(404, { error: 'not_found' })

describe('history page', () => {
  it('lists saved reports, newest first, and shows an empty state when there are none', () => {
    storeHistory([entry('rep-2', 2000, { name: 'Second group' }), entry('rep-1', 1000, { name: 'First group' })])
    const { unmount } = renderAt('/history', <History />, '/history')
    const names = screen.getAllByRole('listitem').map((li) => li.querySelector('strong')?.textContent)
    expect(names).toEqual(['Second group', 'First group'])
    unmount()
    window.localStorage.clear()
    renderAt('/history', <History />, '/history')
    expect(screen.getByText('No chats yet on this device.')).toBeTruthy()
  })

  it('deletes on the server first, then removes the entry locally', async () => {
    const user = userEvent.setup()
    storeHistory([entry('rep-1', 1000)])
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    renderAt('/history', <History />, '/history')

    await user.click(screen.getByRole('button', { name: 'Delete report on The Boys' }))
    await waitFor(() => expect(screen.getByText('No chats yet on this device.')).toBeTruthy())
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(call[0]).toBe('/api/reports/rep-1')
    expect(call[1].method).toBe('DELETE')
    expect(readHistory()).toEqual([])
  })

  it('treats a 404 as already deleted and removes the entry', async () => {
    const user = userEvent.setup()
    storeHistory([entry('rep-1', 1000)])
    vi.stubGlobal('fetch', vi.fn(async () => notFound()))
    renderAt('/history', <History />, '/history')

    await user.click(screen.getByRole('button', { name: 'Delete report on The Boys' }))
    await waitFor(() => expect(readHistory()).toEqual([]))
  })

  it('keeps the entry and shows a message when the server cannot be reached', async () => {
    const user = userEvent.setup()
    storeHistory([entry('rep-1', 1000)])
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    renderAt('/history', <History />, '/history')

    await user.click(screen.getByRole('button', { name: 'Delete report on The Boys' }))
    expect((await screen.findByRole('alert')).textContent).toContain("We couldn't reach the server")
    expect(readHistory()).toHaveLength(1)
  })

  it('still renders when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    renderAt('/history', <History />, '/history')
    expect(screen.getByText('No chats yet on this device.')).toBeTruthy()
    expect(readHistory()).toEqual([])
  })

  it('ignores corrupt entries instead of crashing', () => {
    storeHistory([null, 'junk', entry('rep-1', 1000), { chatId: 5 }])
    renderAt('/history', <History />, '/history')
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })
})

describe('chat hub', () => {
  it('shows the group, its report timeline with titles from the server, and a follow-up entry point', async () => {
    storeHistory([entry('rep-2', 2000), entry('rep-1', 1000)])
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/reports/rep-2') return jsonResponse(200, { ...doneView(), content: { ...reportContent, title: 'Second verdict' } })
        if (url === '/api/reports/rep-1') return jsonResponse(200, { ...doneView(), status: 'running', content: undefined })
        return notFound()
      }),
    )
    renderAt('/c/c1', <Hub />, '/c/:chatId')

    expect(await screen.findByRole('heading', { level: 1, name: 'The Boys' })).toBeTruthy()
    expect(await screen.findByText('Second verdict')).toBeTruthy()
    expect(screen.getByText(/2 reports/)).toBeTruthy()
    expect(screen.getByText(/Writing/)).toBeTruthy()

    const newReport = screen.getByRole('link', { name: 'New report on this chat' })
    expect(newReport.getAttribute('href')).toBe('/c/c1/reports/rep-2#ask')
  })

  it('shows participants from the session, and a deleted report as deleted', async () => {
    setSession(sessionFixture())
    storeHistory([entry('rep-1', 1000)])
    vi.stubGlobal('fetch', vi.fn(async () => notFound()))
    renderAt('/c/c1', <Hub />, '/c/:chatId')

    expect(await screen.findByText('Deleted report')).toBeTruthy()
    const people = screen.getByRole('heading', { name: 'Participants' }).parentElement as HTMLElement
    expect(people.textContent).toContain('Ana')
    expect(people.textContent).toContain('Ben')
  })

  it('deletes the whole chat on the server, removes it locally, and goes to history', async () => {
    const user = userEvent.setup()
    storeHistory([entry('rep-1', 1000)])
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return jsonResponse(200, { ok: true })
      return notFound()
    })
    vi.stubGlobal('fetch', fetchMock)
    renderAt('/c/c1', <Hub />, '/c/:chatId')

    await user.click(await screen.findByRole('button', { name: 'Delete the chat' }))
    await user.click(screen.getByRole('button', { name: 'Yes, delete chat' }))
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/history'))
    expect(readHistory()).toEqual([])
    expect(fetchMock.mock.calls.some((c) => (c as unknown as [string, RequestInit])[1]?.method === 'DELETE')).toBe(true)
  })

  it('offers an upload link when the chat has no reports on this device', () => {
    vi.stubGlobal('fetch', vi.fn(async () => notFound()))
    renderAt('/c/c1', <Hub />, '/c/:chatId')
    expect(screen.getByRole('link', { name: 'Upload a chat' }).getAttribute('href')).toBe('/setup')
    expect(screen.getByText('No reports for this chat on this device yet.')).toBeTruthy()
  })
})
