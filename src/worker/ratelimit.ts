const HOUR_MS = 3_600_000

/**
 * Key used for rate limiting: a full IPv4 address, or the /64 prefix of an IPv6 address (a single
 * subscriber usually owns a whole /64, so rotating inside it must not reset the limit).
 * IPv4-mapped IPv6 addresses count as their IPv4 address. Anything unparseable is used as-is.
 */
export function ipBucketKey(ip: string): string {
  const raw = ip.trim().toLowerCase()
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(raw)
  if (mapped) return mapped[1]
  if (!raw.includes(':')) return raw
  const halves = raw.split('::')
  if (halves.length > 2) return raw
  const head = halves[0] === '' ? [] : halves[0].split(':')
  const tail = halves.length === 2 && halves[1] !== '' ? halves[1].split(':') : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return raw
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail]
  const first4 = groups.slice(0, 4).map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16).toString(16) : null))
  return first4.every((g) => g !== null) ? first4.join(':') : raw
}

/** SHA-256 of the client IP, hex. The raw IP is never stored. */
export async function hashIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Counts one hit in the current hour window for (bucket, ipHash) with a single atomic upsert.
 * Returns true while the count is within perHour. Every hit is counted, including refused ones.
 */
export async function checkRateLimit(
  d1: D1Database,
  ipHash: string,
  bucket: string,
  now: number,
  limits: { perHour: number },
): Promise<boolean> {
  const window = Math.floor(now / HOUR_MS)
  const row = await d1
    .prepare(
      'INSERT INTO rate (key, "window", count) VALUES (?, ?, 1) ' +
        'ON CONFLICT (key, "window") DO UPDATE SET count = count + 1 RETURNING count',
    )
    .bind(`${bucket}:${ipHash}`, window)
    .first<{ count: number }>()
  return row !== null && row.count <= limits.perHour
}

/** Seconds until the current hour window resets (at least 1). */
export function retryAfterSeconds(now: number): number {
  return Math.max(1, Math.ceil((HOUR_MS - (now % HOUR_MS)) / 1000))
}

/** Deletes rate rows whose window started more than about two hours ago. */
export async function deleteOldRateRows(d1: D1Database, now: number): Promise<void> {
  await d1.prepare('DELETE FROM rate WHERE "window" < ?').bind(Math.floor((now - 2 * HOUR_MS) / HOUR_MS)).run()
}
