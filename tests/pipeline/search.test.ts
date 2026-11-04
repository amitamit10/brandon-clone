import { describe, expect, it } from 'vitest'
import { searchChunks } from '../../src/pipeline/search'

const idxs = (r: { idx: number }[]) => r.map((x) => x.idx)

describe('searchChunks (BM25)', () => {
  it('ranks the chunk containing the query terms first', () => {
    const chunks = [
      { idx: 0, text: 'they talked about the weather and the football' },
      { idx: 1, text: 'someone mentioned a holiday in the mountains' },
      { idx: 2, text: 'the pizza was cold so the pizza order was cancelled' },
    ]
    const r = searchChunks(chunks, 'pizza order', 3)
    expect(r[0].idx).toBe(2)
    expect(r[0].score).toBeGreaterThan(0)
    expect(idxs(r)).toEqual([2])
  })

  it('tokenises Hebrew words and emoji', () => {
    const chunks = [
      { idx: 0, text: 'שלום לכולם מה נשמע' },
      { idx: 1, text: 'ערב טוב חברים 🎉 מסיבה הערב' },
      { idx: 2, text: 'הפגישה נדחתה למחר' },
    ]
    expect(idxs(searchChunks(chunks, 'מסיבה', 3))).toEqual([1])
    expect(idxs(searchChunks(chunks, 'שלום', 3))).toEqual([0])
    expect(idxs(searchChunks(chunks, '🎉', 3))).toEqual([1])
    // Hebrew is not stemmed: a different form of the word does not match.
    expect(searchChunks(chunks, 'מסיבות', 3)).toEqual([])
  })

  it('returns at most k results, none with score 0, ties by idx', () => {
    const chunks = [0, 1, 2, 3, 4].map((idx) => ({ idx, text: 'cat dog' }))
    chunks.push({ idx: 5, text: 'bird' })
    const two = searchChunks(chunks, 'cat', 2)
    expect(two).toHaveLength(2)
    expect(idxs(two)).toEqual([0, 1])
    expect(searchChunks(chunks, 'cat', 10)).toHaveLength(5)
    expect(searchChunks(chunks, 'zebra', 10)).toEqual([])
  })

  it('returns [] for empty chunks, an empty query, a blank query or k of 0', () => {
    const chunks = [{ idx: 0, text: 'hello there' }]
    expect(searchChunks([], 'hello', 3)).toEqual([])
    expect(searchChunks(chunks, '', 3)).toEqual([])
    expect(searchChunks(chunks, '   ?!  ', 3)).toEqual([])
    expect(searchChunks(chunks, 'hello', 0)).toEqual([])
  })

  it('caps the query at its first 30 tokens', () => {
    const chunks = [
      { idx: 0, text: 'alpha' },
      { idx: 1, text: 'omega' },
    ]
    // 30 filler tokens, then "omega" as the 31st token: it must be ignored.
    const query = Array.from({ length: 30 }, () => 'alpha').join(' ') + ' omega'
    expect(idxs(searchChunks(chunks, query, 5))).toEqual([0])
  })
})
