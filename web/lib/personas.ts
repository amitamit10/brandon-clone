import type { PersonaId } from '../../src/shared/types'

export interface PersonaInfo {
  id: PersonaId
  name: string
  tagline: string
}

export const PERSONAS: PersonaInfo[] = [
  { id: 'brandon', name: 'Brandon', tagline: 'No filter, full receipts' },
  { id: 'clara', name: 'Clara', tagline: 'Love-science. Kind, but honest.' },
  { id: 'diego', name: 'Diego', tagline: 'Life coach. Practical next steps.' },
]

/** Taglines shown on the report page. Our own copy. */
export const REPORT_TAGLINES: Record<PersonaId, string> = {
  brandon: 'An AI with no filter, too many opinions and a soft spot for gossip.',
  clara: 'Love-science, warmth and the occasional hard truth.',
  diego: 'A life coach who actually read the chat.',
}

export const PERSONA_NAMES: Record<PersonaId, string> = {
  brandon: 'Brandon',
  clara: 'Clara',
  diego: 'Diego',
}
