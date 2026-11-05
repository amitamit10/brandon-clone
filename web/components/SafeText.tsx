import type { ReactNode } from 'react'

/**
 * Renders model text as React text nodes only. Nothing here produces markup from the string:
 * no links, no images, no raw HTML. Supported syntax is deliberately tiny:
 *   - paragraphs are separated by blank lines
 *   - a line starting with "> " is a blockquote line
 *   - **text** is bold
 * Everything else is literal text, including "<img>" and "[a](url)".
 */

export type TextBlock = { kind: 'p' | 'quote'; text: string }

/** Blank-line paragraphs, split again into runs of quote lines and plain lines. Linear time. */
export function parseBlocks(source: string): TextBlock[] {
  const blocks: TextBlock[] = []
  const paragraphs = source.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n(?:[ \t]*\n)*/)
  for (const paragraph of paragraphs) {
    let kind: TextBlock['kind'] | null = null
    let lines: string[] = []
    const flush = () => {
      if (kind !== null && lines.some((l) => l.trim().length > 0)) {
        blocks.push({ kind, text: lines.join('\n') })
      }
      lines = []
    }
    for (const line of paragraph.split('\n')) {
      const lineKind: TextBlock['kind'] = line.startsWith('> ') ? 'quote' : 'p'
      if (lineKind !== kind) {
        flush()
        kind = lineKind
      }
      lines.push(lineKind === 'quote' ? line.slice(2) : line)
    }
    flush()
  }
  return blocks
}

/** Splits one block into literal text and <strong> nodes. Indexes only, so no backtracking. */
export function inlineNodes(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let cursor = 0
  let key = 0
  while (cursor < text.length) {
    const open = text.indexOf('**', cursor)
    if (open === -1) break
    const close = text.indexOf('**', open + 2)
    if (close === -1) break
    if (close === open + 2) {
      // "****" is not bold: keep the two stars as text and go on after them.
      nodes.push(text.slice(cursor, open + 2))
      cursor = open + 2
      continue
    }
    if (open > cursor) nodes.push(text.slice(cursor, open))
    nodes.push(<strong key={`b${key++}`}>{text.slice(open + 2, close)}</strong>)
    cursor = close + 2
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

export interface SafeTextProps {
  text: string
  className?: string
}

export function SafeText({ text, className }: SafeTextProps) {
  const blocks = parseBlocks(text ?? '')
  return (
    <div className={`safe-text${className ? ` ${className}` : ''}`} dir="auto">
      {blocks.map((block, i) =>
        block.kind === 'quote' ? (
          <blockquote key={i} dir="auto" className="safe-quote">
            {inlineNodes(block.text)}
          </blockquote>
        ) : (
          <p key={i} dir="auto">
            {inlineNodes(block.text)}
          </p>
        ),
      )}
    </div>
  )
}
