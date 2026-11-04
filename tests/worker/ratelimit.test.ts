import { describe, expect, it } from 'vitest'
import { ipBucketKey } from '../../src/worker/ratelimit'

describe('ipBucketKey', () => {
  it('keeps a full IPv4 address', () => {
    expect(ipBucketKey('203.0.113.9')).toBe('203.0.113.9')
  })
  it('maps every address in one IPv6 /64 to the same key, however it is written', () => {
    const a = ipBucketKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')
    const b = ipBucketKey('2001:0DB8:0001:0002::1')
    const c = ipBucketKey('2001:db8:1:2::')
    expect(a).toBe(b)
    expect(b).toBe(c)
  })
  it('keeps different /64 prefixes apart', () => {
    expect(ipBucketKey('2001:db8:1:2::1')).not.toBe(ipBucketKey('2001:db8:1:3::1'))
  })
  it('treats an IPv4-mapped IPv6 address as its IPv4 address', () => {
    expect(ipBucketKey('::ffff:203.0.113.9')).toBe('203.0.113.9')
  })
  it('falls back to the raw text for something that is not an address', () => {
    expect(ipBucketKey('unknown')).toBe('unknown')
  })
})
