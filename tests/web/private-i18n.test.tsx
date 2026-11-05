import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from '../../web/lib/i18n'
import { ShareBox, FollowUpBox, DeepDiveButton, DeleteBox } from '../../web/components/PrivateActions'
const settings = { chatId: 'c', name: 'Group', persona: 'brandon' as const, language: 'Hebrew', me: 'Ana' }
afterEach(() => { cleanup(); localStorage.clear() })
it('localizes report actions in Hebrew', () => {
  localStorage.setItem('brandon_lang', 'he')
  render(<I18nProvider><MemoryRouter><ShareBox reportId="r" /><FollowUpBox settings={settings} /><DeepDiveButton settings={settings} name="Ana" /><DeleteBox settings={settings} reportId="r" /></MemoryRouter></I18nProvider>)
  expect(screen.getByRole('button', { name: 'שיתוף הדוח' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'שאלו שאלה מעמיקה' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'ניתוח עומק על Ana' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'מחיקת דוח זה' })).toBeTruthy()
})
