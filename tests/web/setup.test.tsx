import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from '../../web/App'

const PRIVACY = 'Free, for friends. The site owner can read the chats and reports uploaded here, and chats are sent to a free AI provider (Google Gemini or OpenRouter) that may keep or train on them. Uploads are deleted after 30 days.'

/** Android-style export with the given senders, cycling through them. */
function chatText(count: number, senders: string[] = ['Ana', 'Ben']): string {
  const lines: string[] = []
  for (let i = 0; i < count; i++) {
    const day = 1 + Math.floor(i / 24)
    const hour = String(9 + (i % 12)).padStart(2, '0')
    const minute = String((i * 7) % 60).padStart(2, '0')
    lines.push(`8/${day}/25, ${hour}:${minute} - ${senders[i % senders.length]}: message number ${i}`)
  }
  return lines.join('\n')
}

function urlsOf(fetchMock: { mock: { calls: unknown[] } }): string[] {
  return fetchMock.mock.calls.map((c) => (c as unknown as [string])[0])
}

function txt(text: string) {
  return new File([text], 'chat.txt', { type: 'text/plain' })
}

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  )
}

async function uploadChat(user: ReturnType<typeof userEvent.setup>, text = chatText(48)) {
  // The uploader's name is required on the upload step.
  const nameField = screen.getByLabelText('Your name')
  if ((nameField as HTMLInputElement).value === '') await user.type(nameField, 'Dana')
  await user.upload(screen.getByLabelText('Chat export file'), txt(text))
  await waitFor(() => expect((continueButton() as HTMLButtonElement).disabled).toBe(false))
}

function continueButton() {
  return screen.getByRole('button', { name: /^(Continue|Name the group to continue)$/ })
}

/** Walks to step 4 with Ana picked as the user. */
async function walkToPersona(user: ReturnType<typeof userEvent.setup>, groupName = 'The Boys') {
  await uploadChat(user)
  await user.click(continueButton())
  await user.type(screen.getByPlaceholderText('Name this group…'), groupName)
  await user.click(continueButton())
  await user.click(continueButton())
  await user.click(screen.getByRole('button', { name: 'Ana' }))
}

/** Walks to step 5, the start screen. */
async function walkToStart(user: ReturnType<typeof userEvent.setup>, groupName = 'The Boys') {
  await walkToPersona(user, groupName)
  await user.click(continueButton())
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('setup wizard', () => {
  it('keeps Continue disabled until the group is named', async () => {
    const user = userEvent.setup()
    renderAt('/setup')
    await uploadChat(user)
    await user.click(continueButton())

    const blocked = screen.getByRole('button', { name: 'Name the group to continue' })
    expect((blocked as HTMLButtonElement).disabled).toBe(true)

    await user.type(screen.getByPlaceholderText('Name this group…'), 'The Boys')
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the privacy notice on the upload step', () => {
    renderAt('/setup')
    expect(screen.getByText(PRIVACY)).toBeTruthy()
  })

  it('shows the same honest privacy notice on the final step', async () => {
    const user = userEvent.setup()
    renderAt('/setup')
    await walkToStart(user)
    expect(screen.getByText(PRIVACY)).toBeTruthy()
    expect(screen.queryByText(/stays private|under your control/i)).toBeNull()
  })

  it('requires a name before the upload can continue, and prefills the remembered one', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem('brandon.name', 'Remembered Rita')
    renderAt('/setup')
    expect((screen.getByLabelText('Your name') as HTMLInputElement).value).toBe('Remembered Rita')
    await user.clear(screen.getByLabelText('Your name'))
    await user.upload(screen.getByLabelText('Chat export file'), txt(chatText(48)))
    await waitFor(() => expect((continueButton() as HTMLButtonElement).disabled).toBe(true))
    await user.type(screen.getByLabelText('Your name'), 'Dana')
    await waitFor(() => expect((continueButton() as HTMLButtonElement).disabled).toBe(false))
  })

  it('remembers the name in localStorage only after the chat upload succeeds', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async () => jsonResponse(500, { error: 'internal' }))
    vi.stubGlobal('fetch', fetchMock)
    renderAt('/setup')
    await walkToStart(user)
    await user.click(screen.getByRole('button', { name: 'Create my report' }))
    await screen.findByRole('alert')
    expect(window.localStorage.getItem('brandon.name')).toBeNull()
  })

  it('shows a plain message when the upload is too small', async () => {
    const user = userEvent.setup()
    renderAt('/setup')
    await user.upload(screen.getByLabelText('Chat export file'), txt(chatText(5)))

    const alert = await screen.findByRole('alert')
    expect((alert).textContent).toContain(
      'This chat is too short to read. It needs at least 30 messages from two people.',
    )
    expect(alert.className).toContain('shake')
  })

  it('shows a plain message when the file has no chat in it', async () => {
    const user = userEvent.setup()
    renderAt('/setup')
    await user.upload(screen.getByLabelText('Chat export file'), txt('just some words\nand no timestamps at all'))
    expect((await screen.findByRole('alert')).textContent).toContain("couldn't find any messages")
  })

  it('opens the export tutorial and moves through its steps', async () => {
    const user = userEvent.setup()
    renderAt('/setup')
    await user.click(screen.getByRole('button', { name: /See the tutorial/ }))

    const dialog = screen.getByRole('dialog', { name: 'Export a group chat without media' })
    expect(within(dialog).getByText('Step 1 of 6')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Next' }))
    expect(within(dialog).getByText('Step 2 of 6')).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('merges two senders in the members step and shows one fewer name to clean up', async () => {
    const user = userEvent.setup()
    renderAt('/setup')
    await uploadChat(user, chatText(60, ['Ana', 'Ben', 'Ana (work)']))
    await user.click(continueButton())
    await user.type(screen.getByPlaceholderText('Name this group…'), 'Three of us')

    await user.click(screen.getByRole('button', { name: 'Merge profiles' }))
    const dialog = screen.getByRole('dialog', { name: 'Merge profiles' })
    await user.click(within(dialog).getByText('Ana (work)'))
    await user.click(within(dialog).getByText('Ana', { exact: true }))
    await user.click(within(dialog).getByRole('button', { name: 'Merge 2 into Ana' }))
    expect(screen.queryByRole('dialog')).not.toBeTruthy()

    await user.click(continueButton())
    expect(screen.getAllByRole('textbox', { name: /Name for/ })).toHaveLength(2)
  })

  it('persona cards select exactly one persona', async () => {
    const user = userEvent.setup()
    renderAt('/setup')
    await walkToPersona(user)

    const brandon = screen.getByRole('button', { name: /No filter, full receipts/ })
    const clara = screen.getByRole('button', { name: /Love-science/ })
    expect(brandon.getAttribute('aria-pressed')).toBe('true')

    await user.click(clara)
    expect(clara.getAttribute('aria-pressed')).toBe('true')
    expect(brandon.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: /Life coach/ }).getAttribute('aria-pressed')).toBe('false')
  })

  it('language "Other" rejects digits and blocks Continue until the entry is valid', async () => {
    const user = userEvent.setup()
    renderAt('/setup')
    await walkToPersona(user)
    await user.click(screen.getByRole('button', { name: 'Other' }))

    const other = screen.getByPlaceholderText('e.g. Swahili')
    await user.type(other, 'Klingon2')
    expect(screen.getByText('Use 2 to 40 letters or spaces, no numbers.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)

    await user.clear(other)
    await user.type(other, 'Klingon')
    expect(screen.queryByText('Use 2 to 40 letters or spaces, no numbers.')).not.toBeTruthy()
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('starting a report calls both endpoints, stores only ids, and opens the report route', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/chats') return jsonResponse(201, { chatId: 'chat-1' })
      if (url === '/api/chats/chat-1/reports') return jsonResponse(201, { reportId: 'rep-1' })
      return jsonResponse(404, {})
    })
    vi.stubGlobal('fetch', fetchMock)
    renderAt('/setup')
    await walkToStart(user)
    await user.click(screen.getByRole('button', { name: 'Create my report' }))

    // The report route starts its advance loop as soon as it mounts.
    await waitFor(() => expect(urlsOf(fetchMock)).toContain('/api/reports/rep-1/advance'))

    expect(fetchMock).toHaveBeenCalledTimes(3)
    const [chatUrl, chatInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(chatUrl).toBe('/api/chats')
    const chatBody = JSON.parse(chatInit.body as string)
    expect(Object.keys(chatBody).sort()).toEqual(['chunks', 'name', 'participants', 'stats', 'uploaderName'])
    expect(chatBody.name).toBe('The Boys')
    expect(chatBody.uploaderName).toBe('Dana')
    expect(chatBody.participants).toEqual(['Ana', 'Ben'])
    expect(chatBody.stats.total).toBe(48)
    expect(chatBody.chunks[0]).toEqual(expect.objectContaining({ index: 0, fromId: 0 }))

    const [reportUrl, reportInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit]
    expect(reportUrl).toBe('/api/chats/chat-1/reports')
    expect(JSON.parse(reportInit.body as string)).toEqual({
      persona: 'brandon',
      language: 'English',
      me: 'Ana',
      kind: 'group',
    })

    const stored = JSON.parse(window.localStorage.getItem('brandon.history') ?? '[]')
    expect(stored).toHaveLength(1)
    expect(stored[0]).toEqual(
      expect.objectContaining({ chatId: 'chat-1', reportId: 'rep-1', name: 'The Boys' }),
    )
    expect(window.localStorage.getItem('brandon.history')).not.toContain('message number')
    expect(window.localStorage.getItem('brandon.name')).toBe('Dana')
  })

  it('still starts a report when localStorage throws', async () => {
    const user = userEvent.setup()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const fetchMock = vi.fn(async (url: string) =>
      url === '/api/chats' ? jsonResponse(201, { chatId: 'chat-2' }) : jsonResponse(201, { reportId: 'rep-2' }),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderAt('/setup')
    await walkToStart(user)
    await user.click(screen.getByRole('button', { name: 'Create my report' }))

    await waitFor(() => expect(urlsOf(fetchMock)).toContain('/api/reports/rep-2/advance'))
  })

  it('shows a friendly message for HTTP 429 and keeps the user on the page', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(429, { error: 'rate_limited' })))
    renderAt('/setup')
    await walkToStart(user)
    await user.click(screen.getByRole('button', { name: 'Create my report' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/made a lot of requests/)
    expect((screen.getByRole('button', { name: 'Create my report' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows a friendly message when the network fails', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    renderAt('/setup')
    await walkToStart(user)
    await user.click(screen.getByRole('button', { name: 'Create my report' }))

    expect((await screen.findByRole('alert')).textContent).toContain("We couldn't reach the server")
  })

  it('retrying after a failed report call does not upload the chat again', async () => {
    const user = userEvent.setup()
    let reportCalls = 0
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/chats') return jsonResponse(201, { chatId: 'chat-3' })
      reportCalls++
      return reportCalls === 1 ? jsonResponse(503, {}) : jsonResponse(201, { reportId: 'rep-3' })
    })
    vi.stubGlobal('fetch', fetchMock)
    renderAt('/setup')
    await walkToStart(user)
    await user.click(screen.getByRole('button', { name: 'Create my report' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/busy right now/)

    await user.click(screen.getByRole('button', { name: 'Create my report' }))
    await waitFor(() => expect(urlsOf(fetchMock)).toContain('/api/reports/rep-3/advance'))

    expect(urlsOf(fetchMock).slice(0, 3)).toEqual(['/api/chats', '/api/chats/chat-3/reports', '/api/chats/chat-3/reports'])
  })

  it('goes back to the landing page from step 1', async () => {
    const user = userEvent.setup()
    renderAt('/setup')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: /Upload a group chat/ })).toBeTruthy())
  })
})
