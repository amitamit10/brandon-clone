import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { I18nProvider } from '../../web/lib/i18n'
import { ThinkingScreen } from '../../web/components/ThinkingScreen'
afterEach(() => { cleanup(); localStorage.clear() })
it('shows Hebrew progress when the interface is Hebrew', () => {
  localStorage.setItem('brandon_lang', 'he')
  render(<I18nProvider><ThinkingScreen persona="brandon" progress={1} total={3} retrying={false} /></I18nProvider>)
  expect(screen.getByText('ברנדון חושב…')).toBeTruthy()
  expect(screen.getByText('קורא חלק 1 מתוך 2')).toBeTruthy()
})
