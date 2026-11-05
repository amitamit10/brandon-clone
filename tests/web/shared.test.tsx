import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Shared } from '../../web/pages/Shared'
import { setSession } from '../../web/lib/session'
import { HISTORY_KEY } from '../../web/lib/history'
import { jsonResponse, reportContent, sessionFixture } from './fixtures'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

function renderShared(shareId = 's1') {
  return render(
    <MemoryRouter initialEntries={[`/s/${shareId}`]}>
      <Routes>
        <Route path="/s/:shareId" element={<Shared />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('shared page', () => {
  it('renders the report read-only, with no share or follow-up controls, and a way to make your own', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(200, { groupName: 'The Boys', persona: 'clara', language: 'English', content: reportContent }),
      ),
    )
    renderShared('abc')

    expect(await screen.findByRole('heading', { level: 1, name: reportContent.title })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Share the report' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Ask a deeper question' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Deep dive/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'Make your own' }).getAttribute('href')).toBe('/')
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/shared/abc')
  })

  it('shows a friendly message for a revoked or expired link', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(404, { error: 'not_found' })))
    renderShared()
    expect(await screen.findByRole('heading', { name: 'This link is no longer active' })).toBeTruthy()
    expect(screen.getByText(/stopped sharing it, or it has expired/)).toBeTruthy()
  })

  it('shows a plain message when the server cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    renderShared()
    expect((await screen.findByRole('alert')).textContent).toContain("We couldn't reach the server")
  })

  it('never reads the in-memory session or the browser history', async () => {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify([{ chatId: 'c1', reportId: 'rep-1', name: 'Mine', createdAt: 1 }]))
    setSession(sessionFixture())
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { groupName: 'Their group', persona: 'brandon', language: 'English', content: reportContent })),
    )
    renderShared()
    await screen.findByRole('heading', { level: 1, name: reportContent.title })

    expect(getItem.mock.calls.map((c) => c[0])).not.toContain(HISTORY_KEY)
    expect(screen.queryByText('Mine')).toBeNull()
    expect(screen.queryByText('The Boys')).toBeNull()
  })
})
