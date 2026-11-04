export const LANGUAGES = [
  'English',
  'Spanish',
  'French',
  'Italian',
  'German',
  'Portuguese (Brazil)',
  'Portuguese (Portugal)',
  'Dutch',
  'Indonesian',
  'Hebrew',
  'Arabic',
  'Turkish',
] as const

/** Other languages: 2 to 40 letters or spaces. Digits and punctuation are rejected. */
const OTHER_LANGUAGE = /^[\p{L} ]{2,40}$/u

/** Returns the trimmed language name, or null when it is not acceptable. */
export function validOtherLanguage(raw: string): string | null {
  const trimmed = raw.trim()
  return OTHER_LANGUAGE.test(trimmed) ? trimmed : null
}
