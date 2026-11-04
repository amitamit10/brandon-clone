import { describe, expect, it } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { ParseError } from '../../src/shared/types'
import { analyzeFile } from '../../web/lib/analyze'
import { uploadErrorMessage } from '../../web/lib/messages'

/** Android-style export: 48 messages from two senders over two days. */
function chatText(count: number): string {
  const lines: string[] = []
  for (let i = 0; i < count; i++) {
    const day = 1 + Math.floor(i / 24)
    const hour = String(9 + (i % 12)).padStart(2, '0')
    const minute = String((i * 7) % 60).padStart(2, '0')
    const sender = i % 3 === 0 ? 'Ana' : 'Ben'
    lines.push(`8/${day}/25, ${hour}:${minute} - ${sender}: message number ${i} 😀`)
  }
  return lines.join('\n')
}

const txtFile = (text: string, name = 'chat.txt') => new File([text], name, { type: 'text/plain' })

describe('analyzeFile', () => {
  it('returns stats and chunks for a bare .txt export', async () => {
    const result = await analyzeFile(txtFile(chatText(48)))

    expect(result.messageCount).toBe(48)
    expect(result.chat.participants).toEqual(['Ana', 'Ben'])
    expect(result.stats.total).toBe(48)
    expect(Object.keys(result.stats.perMember).sort()).toEqual(['Ana', 'Ben'])
    expect(result.stats.perMember.Ana.messages).toBe(16)
    expect(result.chunks.length).toBeGreaterThan(0)
    expect(result.chunks[0].fromId).toBe(0)
    expect(result.chunks[result.chunks.length - 1].toId).toBe(47)
  })

  it('reads the chat from inside a WhatsApp zip export', async () => {
    const zip = zipSync({ '_chat.txt': strToU8(chatText(40)), 'contact.vcf': strToU8('BEGIN:VCARD') })
    const result = await analyzeFile(new File([zip], 'WhatsApp Chat.zip', { type: 'application/zip' }))

    expect(result.messageCount).toBe(40)
    expect(result.chat.participants).toEqual(['Ana', 'Ben'])
  })

  it('rejects a chat with too few messages using the too_small code', async () => {
    const error = await analyzeFile(txtFile(chatText(5))).then(
      () => null,
      (e: unknown) => e,
    )

    expect(error).toBeInstanceOf(ParseError)
    expect((error as ParseError).code).toBe('too_small')
    expect(uploadErrorMessage(error)).toBe(
      'This chat is too short to read. It needs at least 30 messages from two people.',
    )
  })

  it('rejects a file that is neither a zip nor a .txt', async () => {
    const error = await analyzeFile(new File(['hello'], 'photo.jpg')).then(
      () => null,
      (e: unknown) => e,
    )
    expect((error as ParseError).code).toBe('no_chat_file')
  })
})
