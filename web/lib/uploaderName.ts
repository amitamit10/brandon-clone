/** localStorage key for the uploader's own name, prefilled in the wizard. */
export const NAME_KEY = 'brandon.name'
const MAX_CHARS = 60

/** Same rules as the server: whitespace collapsed, control and bidi/format characters removed, 1 to 60 characters. */
export function cleanName(raw: string): string {
  return raw
    .replace(/\s+/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

export function isValidName(raw: string): boolean {
  const cleaned = cleanName(raw)
  return cleaned.length > 0 && Array.from(cleaned).length <= MAX_CHARS
}

/** The remembered name, or '' when storage is missing or blocked. */
export function loadUploaderName(): string {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

/** Remembers the name for the next visit. Storage problems are ignored. */
export function saveUploaderName(name: string): void {
  try {
    window.localStorage.setItem(NAME_KEY, cleanName(name))
  } catch {
    // Private windows and blocked storage: the name is simply not remembered.
  }
}
