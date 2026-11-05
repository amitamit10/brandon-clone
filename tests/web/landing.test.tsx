import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Landing } from '../../web/pages/Landing'
import { DEMO_CHATS } from '../../web/lib/demo'

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/setup" element={<p>Setup page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(cleanup)

describe('Landing page', () => {
  it('renders the headline and a CTA that links to /setup', async () => {
    renderLanding()

    expect(
      screen.getByRole('heading', { level: 1, name: "Upload a group chat. Brandon tells you what's really going on." }),
    ).toBeTruthy()

    const cta = screen.getByRole('link', { name: /Upload your chat/ })
    expect(cta.getAttribute('href')).toBe('/setup')

    await userEvent.click(cta)
    expect(await screen.findByText('Setup page')).toBeTruthy()
  })

  it('shows the privacy notice', () => {
    renderLanding()
    expect(
      screen.getByText(
        'Free, for friends. The site owner can read the chats and reports uploaded here, and chats are sent to a free AI provider (Google Gemini or OpenRouter) that may keep or train on them. Uploads are deleted after 30 days.',
      ),
    ).toBeTruthy()
  })

  it('shows a demo card when a chat pill is tapped', async () => {
    renderLanding()
    const pill = screen.getByRole('button', { name: /The Boys/ })
    expect(pill.getAttribute('aria-pressed')).toBe('false')

    await userEvent.click(pill)

    const demoTitle = DEMO_CHATS.find((c) => c.id === 'the-boys')!.title
    expect(screen.getByRole('heading', { name: demoTitle })).toBeTruthy()
    expect(pill.getAttribute('aria-pressed')).toBe('true')
    const card = screen.getByRole('heading', { name: demoTitle }).closest('.demo-card') as HTMLElement
    expect(within(card).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText('Made-up example, not from a real chat.')).toBeTruthy()
  })

  it('switches the demo when another pill is tapped', async () => {
    renderLanding()
    await userEvent.click(screen.getByRole('button', { name: /Family/ }))
    await userEvent.click(screen.getByRole('button', { name: /Uni crew/ }))

    expect((screen.getByRole('button', { name: /Uni crew/ })).getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByRole('button', { name: /Family/ })).getAttribute('aria-pressed')).toBe('false')
  })
})
