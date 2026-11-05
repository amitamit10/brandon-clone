import { I18nProvider } from '../../web/lib/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { TutorialModal } from '../../web/components/TutorialModal'

afterEach(() => { cleanup(); vi.useRealTimers() })
describe('tutorial playback', () => {
  it('advances automatically and allows pausing and selecting a step', () => {
    vi.useFakeTimers()
    render(<TutorialModal onClose={() => {}} />)
    act(() => vi.advanceTimersByTime(4000))
    expect(screen.getByText('Step 2 of 6')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Pause tutorial' }))
    act(() => vi.advanceTimersByTime(8000))
    expect(screen.getByText('Step 2 of 6')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Go to step 4' }))
    expect(screen.getByText('Step 4 of 6')).toBeTruthy()
  })
})

it('shows tutorial directions and playback controls in Hebrew', () => {
  localStorage.setItem('brandon_lang', 'he')
  render(<I18nProvider><TutorialModal onClose={() => {}} /></I18nProvider>)
  expect(screen.getByRole('heading', { name: 'פתיחת הקבוצה' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'השהיית ההדרכה' })).toBeTruthy()
  localStorage.clear()
})
