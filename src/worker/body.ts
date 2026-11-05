import { ApiError } from './validate'

/**
 * Reads the body up to max bytes. The declared content-length is checked first, then the bytes
 * actually received, so a missing or false header cannot bypass the cap. The reader is cancelled as
 * soon as the cap is passed, so nothing beyond it is read.
 */
export async function readBounded(req: Request, max: number): Promise<Uint8Array> {
  const declared = req.headers.get('content-length')
  if (declared !== null && Number(declared) > max) throw new ApiError(413, 'too_large')
  if (!req.body) return new Uint8Array(0)
  const reader = req.body.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      throw new ApiError(413, 'too_large')
    }
    parts.push(value)
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}
