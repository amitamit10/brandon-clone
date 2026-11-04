import { unzipSync } from 'fflate'
import { ParseError } from '../shared/types'

const decoder = new TextDecoder('utf-8')

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
    if (filename.toLowerCase().endsWith('.txt')) return decodeText(bytes)
    throw new ParseError('no_chat_file')
  }
  const entries = unzipSync(bytes, {
    filter: (file) => file.name.toLowerCase().endsWith('.txt'),
  })
  let best: Uint8Array | undefined
  for (const data of Object.values(entries)) {
    if (!best || data.length > best.length) best = data
  }
  if (!best) throw new ParseError('no_chat_file')
  return decodeText(best)
}
