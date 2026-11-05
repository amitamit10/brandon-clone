import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Admin } from '../../web/pages/Admin'
import { SafeText } from '../../web/components/AdminSafeText'

const TOKEN = 'a-very-long-admin-token-123456'

const overviewFixture = {
  totals: {
    chatsActive: 3,
    chatsAll: 7,
    reportsAll: 9,
    reportsByStatus: { queued: 1, running: 0, done: 6, failed: 2 },
    reportsByKind: { group: 7, member: 1, followup: 1 },
    reportsByPersona: { brandon: 5, clara: 3, diego: 1 },
    sharedLinks: 2,
    storedChunkKB: 512,
    contentViews: 4,
  },
  daily: Array.from({ length: 30 }, (_, i) => ({
    day: `2026-11-${String(i + 1).padStart(2, '0')}`,
    uploads: i % 3,
    reportsCreated: 1,
    reportsDone: 1,
    reportsFailed: 0,
    llmCalls: 5,
    llmFails: 1,
    rateLimited: 0,
    visitors: 2,
    uploadKB: 100,
  })),
  llmByModel: [{ key: 'gemini:gemini-flash-lite-latest', calls: 40, fails: 3, rate429: 2 }],
  avgReportSeconds: 95,
  adminLoginFailed: 1,
}

const chatsFixture = {
  chats: [
    {
      id: 'a1b2c3d4'.padEnd(32, '0'),
      id8: 'a1b2c3d4',
      groupName: 'The Boys',
      uploaderName: 'dana',
      participantNames: ['Ana', 'Ben'],
      participants: 2,
      messages: 48,
      chunks: 1,
      reports: 1,
      reportsDone: 1,
      hasShared: true,
      createdAt: Date.UTC(2026, 10, 4),
      expiresAt: Date.UTC(2026, 11, 4),
      expired: false,
    },
  ],
  total: 1,
}

const detailFixture = {
  ...chatsFixture.chats[0],
  reports: [
    {
      id: 'r1'.padEnd(32, '0'),
      id8: 'r1000000',
      kind: 'group',
      persona: 'brandon',
      language: 'English',
      me: 'Ana',
      subject: null,
      question: null,
      status: 'done',
      progress: 2,
      total: 2,
      failures: 0,
      error: null,
      createdAt: Date.UTC(2026, 10, 4),
      shared: true,
      content: {
        title: 'Report title',
        intro: 'Intro with **bold** words',
        sections: [{ heading: 'Numbers', body: 'They talk.\n\n> hello there\n\nDone.' }],
        members: [{ name: 'Ana', opinion: 'Talks a lot.', quote: 'hello there' }],
        advice: 'Keep going.',
      },
    },
  ],
}

function json(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

/** Routes admin API calls to fixtures. Override a route by passing its handler. */
function stubApi(overrides: Partial<Record<string, (init: RequestInit | undefined) => Response>> = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const key = `${method} ${url.split('?')[0]}`
    const override = overrides[key] ?? overrides[url]
    if (override) return override(init)
    if (key === 'GET /api/admin/overview') return json(200, overviewFixture)
    if (key === 'GET /api/admin/chats') return json(200, chatsFixture)
    if (key === 'GET /api/admin/uploaders') return json(200, { uploaders: [{ uploaderName: 'dana', chats: 1, reports: 1, lastSeen: 1 }] })
    if (key === `GET /api/admin/chats/${chatsFixture.chats[0].id}`) return json(200, detailFixture)
    if (key.startsWith('GET /api/admin/chats/') && key.endsWith('/messages')) return json(200, { chunk: 0, chunks: 1, text: 'MSG-LINE one\nMSG-LINE two' })
    if (key === `DELETE /api/admin/chats/${chatsFixture.chats[0].id}`) return json(200, { ok: true })
    if (key === 'POST /api/admin/login') return json(200, { ok: true })
    return json(404, { error: 'not_found' })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderAdmin() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** Waits for the dashboard when the session is already valid. */
async function dashboard() {
  return screen.findByRole('heading', { name: 'Overview' })
}

/** Logs in through the form with the fixture token and waits for the dashboard. */
async function logIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Admin token'), TOKEN)
  await user.click(screen.getByRole('button', { name: 'Log in' }))
  await screen.findByRole('heading', { name: 'Overview' })
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.head.querySelectorAll('meta[name="robots"]').forEach((m) => m.remove())
})

describe('admin login', () => {
  it('shows the login form when the session is missing (401), then the dashboard after login', async () => {
    const user = userEvent.setup()
    let loggedIn = false
    stubApi({
      'GET /api/admin/overview': () => (loggedIn ? json(200, overviewFixture) : json(401, { error: 'unauthorized' })),
      'POST /api/admin/login': () => {
        loggedIn = true
        return json(200, { ok: true })
      },
    })
    renderAdmin()
    expect(await screen.findByLabelText('Admin token')).toBeTruthy()
    await logIn(user)
    expect(screen.getByText('Active chats')).toBeTruthy()
  })

  it('clears the token field after submit and never writes the token to storage', async () => {
    const user = userEvent.setup()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const fetchMock = stubApi({ 'GET /api/admin/overview': () => json(401, { error: 'unauthorized' }) })
    renderAdmin()
    const field = (await screen.findByLabelText('Admin token')) as HTMLInputElement
    await user.type(field, TOKEN)
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    await waitFor(() => expect(field.value).toBe(''))
    expect(setItem).not.toHaveBeenCalled()
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
    expect(window.location.href).not.toContain(TOKEN)
    const login = fetchMock.mock.calls.find((c) => c[0] === '/api/admin/login') as unknown as [string, RequestInit]
    expect(login[1].credentials).toBe('same-origin')
    expect((login[1].headers as Record<string, string>)['X-Admin']).toBe('1')
    expect(JSON.parse(login[1].body as string)).toEqual({ token: TOKEN })
  })

  it('says the admin is not enabled on 404 and says wrong token on 401 after a login', async () => {
    const user = userEvent.setup()
    stubApi({ 'GET /api/admin/overview': () => json(404, { error: 'not_found' }) })
    renderAdmin()
    expect(await screen.findByText('Admin is not enabled')).toBeTruthy()
    cleanup()
    stubApi({
      'GET /api/admin/overview': () => json(401, { error: 'unauthorized' }),
      'POST /api/admin/login': () => json(401, { error: 'unauthorized' }),
    })
    renderAdmin()
    await user.type(await screen.findByLabelText('Admin token'), 'wrong-wrong-wrong-wrong-wrong')
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    expect(await screen.findByText('That token is not right.')).toBeTruthy()
  })

  it('returns to the login screen when a later request answers 401', async () => {
    const user = userEvent.setup()
    let expired = false
    stubApi({
      'GET /api/admin/overview': () => (expired ? json(401, { error: 'unauthorized' }) : json(200, overviewFixture)),
    })
    renderAdmin()
    await dashboard()
    expired = true
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByLabelText('Admin token')).toBeTruthy()
  })
})

describe('admin dashboard', () => {
  it('renders the tiles from the overview fixture', async () => {
    const user = userEvent.setup()
    stubApi({ 'GET /api/admin/overview': () => json(200, overviewFixture) })
    renderAdmin()
    await dashboard()
    const tiles = screen.getByRole('region', { name: 'Totals' })
    expect(within(tiles).getByText('Active chats').parentElement?.textContent).toContain('3')
    expect(within(tiles).getByText('Reports').parentElement?.textContent).toContain('9')
    expect(within(tiles).getByText('Shared links').parentElement?.textContent).toContain('2')
    expect(within(tiles).getByText('Avg report time').parentElement?.textContent).toContain('95')
  })

  it('marks the page as noindex', async () => {
    stubApi({ 'GET /api/admin/overview': () => json(401, { error: 'unauthorized' }) })
    renderAdmin()
    await screen.findByLabelText('Admin token')
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex')
  })

  it('requires two clicks to delete a chat, and shows only names the API sent', async () => {
    const user = userEvent.setup()
    const fetchMock = stubApi({ 'GET /api/admin/overview': () => json(200, overviewFixture) })
    renderAdmin()
    await dashboard()
    await user.click(await screen.findByRole('button', { name: /The Boys/ }))
    await screen.findByText('Report title')
    expect(screen.getByText('dana')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Delete chat' }))
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'DELETE')).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Confirm delete chat' }))
    expect(fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'DELETE')).toHaveLength(1)
  })
})

describe('SafeText', () => {
  it('renders paragraphs, quotes and bold as text, never as HTML', () => {
    const { container } = render(<SafeText text={'Hello **bold** <img src=x onerror=alert(1)>\n\n> quoted line'} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('strong')?.textContent).toBe('bold')
    expect(container.querySelector('blockquote')?.textContent).toBe('quoted line')
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
  })
})
