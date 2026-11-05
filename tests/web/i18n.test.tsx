import { describe, expect, it, beforeEach } from 'vitest'
import { translations, getInitialLang, setStoredLang, type Lang } from '../../web/lib/i18n'

describe('i18n', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('dir')
    document.documentElement.removeAttribute('lang')
  })

  it('defaults to en in test runner when localStorage is empty and navigator is en', () => {
    expect(getInitialLang()).toBe('en')
  })

  it('reads he from localStorage when present', () => {
    localStorage.setItem('brandon_lang', 'he')
    expect(getInitialLang()).toBe('he')
  })

  it('updates document dir and lang when setStoredLang is called', () => {
    setStoredLang('he')
    expect(localStorage.getItem('brandon_lang')).toBe('he')
    expect(document.documentElement.getAttribute('dir')).toBe('rtl')
    expect(document.documentElement.getAttribute('lang')).toBe('he')

    setStoredLang('en')
    expect(localStorage.getItem('brandon_lang')).toBe('en')
    expect(document.documentElement.getAttribute('dir')).toBe('ltr')
    expect(document.documentElement.getAttribute('lang')).toBe('en')
  })

  it('has identical keys for en and he translations', () => {
    const enKeys = Object.keys(translations.en)
    const heKeys = Object.keys(translations.he)
    expect(heKeys.sort()).toEqual(enKeys.sort())

    for (const key of enKeys) {
      const enSection = (translations.en as any)[key]
      const heSection = (translations.he as any)[key]
      if (typeof enSection === 'object' && enSection !== null && !Array.isArray(enSection)) {
        expect(Object.keys(heSection).sort()).toEqual(Object.keys(enSection).sort())
      }
    }
  })
})
