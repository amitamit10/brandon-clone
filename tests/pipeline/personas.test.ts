import { describe, expect, it } from 'vitest'
import { PERSONAS } from '../../src/pipeline/personas'

describe('PERSONAS', () => {
  it('has brandon, clara and diego with distinct, non-empty systems', () => {
    expect(Object.keys(PERSONAS).sort()).toEqual(['brandon', 'clara', 'diego'])
    const systems = Object.values(PERSONAS).map((p) => p.system)
    for (const p of Object.values(PERSONAS)) {
      expect(p.name.length).toBeGreaterThan(0)
      expect(p.system.length).toBeGreaterThan(200)
    }
    expect(new Set(systems).size).toBe(3)
  })

  it('every system prompt sets the grounding, quoting and language rules', () => {
    for (const p of Object.values(PERSONAS)) {
      expect(p.system).toMatch(/ground/i)
      expect(p.system).toMatch(/verbatim/i)
      expect(p.system).toMatch(/language/i)
      expect(p.system).toMatch(/ONLY JSON/)
      expect(p.system).toMatch(/what would I do/i)
    }
  })
})
