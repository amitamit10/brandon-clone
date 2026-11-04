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

export const PERSONA_NAMES: Record<PersonaId, string> = {
  brandon: 'Brandon',
  clara: 'Clara',
  diego: 'Diego',
}
