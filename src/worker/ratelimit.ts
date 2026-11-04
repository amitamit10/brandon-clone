const HOUR_MS = 3_600_000

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
