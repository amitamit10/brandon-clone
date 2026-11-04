import { extractChatText } from '../../src/parser/zip'
import { parseExport } from '../../src/parser/whatsapp'
import { computeStats, assertAnalyzable } from '../../src/stats/compute'
import { chunkMessages } from '../../src/pipeline/chunk'
import type { ChatStats, Chunk, ParsedChat } from '../../src/shared/types'

export interface Analyzed {
  chat: ParsedChat
  stats: ChatStats
  chunks: Chunk[]
  messageCount: number
}

/** Lets the browser paint between the heavier stages. */
const yieldToMain = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function readFileBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}

/** Stats and chunks for an already parsed chat. Synchronous; call again after renames. */
export function reanalyze(chat: ParsedChat): Analyzed {
  return {
    chat,
    stats: computeStats(chat),
    chunks: chunkMessages(chat),
    messageCount: chat.messages.length,
  }
}

/**
 * Runs the whole pipeline in the browser: extract text, parse, check, stats, chunks.
 * Throws a ParseError (see src/shared/types.ts) for anything that cannot be analysed.
 */
export async function analyzeFile(file: File): Promise<Analyzed> {
  const bytes = new Uint8Array(await readFileBytes(file))
  const text = extractChatText(bytes, file.name)
  const chat = parseExport(text)
  assertAnalyzable(chat)
  await yieldToMain()
  return reanalyze(chat)
}
