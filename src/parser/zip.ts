import { unzipSync } from 'fflate'
import { ParseError } from '../shared/types'

const decoder = new TextDecoder('utf-8')

/** Hard caps on untrusted input, enforced on declared sizes before anything is inflated. */
export const MAX_TEXT_BYTES = 10 * 1024 * 1024
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024
export const MAX_ENTRIES = 16

function decodeText(bytes: Uint8Array): string {
  return decoder.decode(bytes).replace(/^﻿/, '')
}

/** Zip local-file-header magic: "PK\x03\x04". Detected by content, not by filename. */
function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

/**
 * Returns the chat text from a bare .txt upload or from a WhatsApp export zip.
 * Inside a zip, the largest .txt entry wins. Entry names are matched on the
 * decoded name's extension only, because real exports can carry non-UTF-8 names.
 */
export function extractChatText(bytes: Uint8Array, filename: string): string {
  if (!isZip(bytes)) {
    if (!filename.toLowerCase().endsWith('.txt')) throw new ParseError('no_chat_file')
    if (bytes.length > MAX_TEXT_BYTES) throw new ParseError('file_too_large')
    return decodeText(bytes)
  }
  let total = 0
  let count = 0
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        if (!file.name.toLowerCase().endsWith('.txt')) return false
        total += file.originalSize
        if (++count > MAX_ENTRIES || file.originalSize > MAX_TEXT_BYTES || total > MAX_TOTAL_BYTES) {
          throw new ParseError('file_too_large')
        }
        return true
      },
    })
  } catch (e) {
    if (e instanceof ParseError) throw e
    throw new ParseError('bad_zip')
  }
  let best: Uint8Array | undefined
  for (const data of Object.values(entries)) {
    if (!best || data.length > best.length) best = data
  }
  if (!best) throw new ParseError('no_chat_file')
  return decodeText(best)
}
