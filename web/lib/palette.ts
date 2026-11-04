/** Pastel accents, cycled per person so each member keeps one colour across the wizard. */
export const PASTELS = ['#d9ccff', '#ffc6dc', '#ffd2b8', '#bdf2de', '#ffeaa7'] as const

export function pastelFor(index: number): string {
  return PASTELS[index % PASTELS.length]
}

/** First visible character of a name, upper-cased, for letter avatars. */
export function initialOf(name: string): string {
  const first = Array.from(name.trim())[0]
  return first ? first.toUpperCase() : '?'
}
