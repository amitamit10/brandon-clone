import { describe, expect, it } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { extractChatText } from '../../src/parser/zip'
import { ParseError } from '../../src/shared/types'

const chatTxt = '8/28/25, 23:29 - Name: hi\n8/28/25, 23:30 - Other: hello\n'

function zipOf(files: Record<string, string | Uint8Array>): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const [name, data] of Object.entries(files)) entries[name] = typeof data === 'string' ? strToU8(data) : data
  return zipSync(entries)
}

describe('extractChatText', () => {
  it('returns text of a bare .txt upload', () => {
    expect(extractChatText(strToU8(chatTxt), 'chat.txt')).toBe(chatTxt)
  })

  it('strips a UTF-8 BOM from a bare .txt upload', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...strToU8(chatTxt)])
    expect(extractChatText(bytes, 'WhatsApp Chat.TXT')).toBe(chatTxt)
  })

  it('finds the .txt inside a zip with a .vcf beside it', () => {
    const zip = zipOf({ '_chat.txt': chatTxt, 'contact.vcf': 'BEGIN:VCARD\nEND:VCARD\n' })
    expect(extractChatText(zip, 'export.zip')).toBe(chatTxt)
  })

  it('picks the largest .txt when a zip has several', () => {
    const small = 'small file\n'
    const zip = zipOf({ 'a-notes.txt': small, '_chat.txt': chatTxt })
    expect(extractChatText(zip, 'export.zip')).toBe(chatTxt)
  })

  it('works when entry names are not valid UTF-8', () => {
    // Same-length ASCII placeholder, then patch its bytes to invalid UTF-8 in both
    // the local header and the central directory.
    const zip = zipOf({ 'AAAA.txt': chatTxt })
    const placeholder = [0x41, 0x41, 0x41, 0x41]
    const replacement = [0xff, 0xfe, 0x80, 0x81]
    const out = Array.from(zip)
    for (let i = 0; i + 4 <= out.length; i++) {
      if (placeholder.every((b, k) => out[i + k] === b)) {
        out.splice(i, 4, ...replacement)
        i += 3
      }
    }
    const patched = new Uint8Array(out)
    expect(out.filter((b) => b === 0xff)).toHaveLength(2) // local header + central directory
    expect(extractChatText(patched, 'export.zip')).toBe(chatTxt)
  })

  it('throws no_chat_file for a zip without .txt', () => {
    const zip = zipOf({ 'contact.vcf': 'BEGIN:VCARD\nEND:VCARD\n', 'photo.jpg': new Uint8Array([1, 2, 3]) })
    let caught: unknown
    try {
      extractChatText(zip, 'export.zip')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ParseError)
    expect((caught as ParseError).code).toBe('no_chat_file')
  })

  const codeOf = (fn: () => unknown): string | undefined => {
    try {
      fn()
    } catch (e) {
      return e instanceof ParseError ? e.code : `other:${(e as Error).message}`
    }
    return undefined
  }

  it('rejects an entry whose declared size exceeds the cap, before inflating it', () => {
    const bomb = zipOf({ '_chat.txt': new Uint8Array(11 * 1024 * 1024) }) // compresses to a few KB
    expect(bomb.length).toBeLessThan(100 * 1024)
    expect(codeOf(() => extractChatText(bomb, 'export.zip'))).toBe('file_too_large')
  })

  it('rejects a zip with too many .txt entries', () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 17; i++) files[`f${i}.txt`] = 'x\n'
    expect(codeOf(() => extractChatText(zipOf(files), 'export.zip'))).toBe('file_too_large')
  })

  it('rejects a bare .txt over the cap', () => {
    expect(codeOf(() => extractChatText(new Uint8Array(11 * 1024 * 1024).fill(65), 'chat.txt'))).toBe('file_too_large')
  })

  it('wraps malformed archives in ParseError bad_zip', () => {
    const zip = zipOf({ '_chat.txt': chatTxt })
    const broken = zip.slice(0, Math.floor(zip.length / 2)) // truncated: starts with PK header, ends mid-archive
    expect(codeOf(() => extractChatText(broken, 'export.zip'))).toBe('bad_zip')
  })
})
