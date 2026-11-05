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
  const paragraphs = (source ?? '').replace(/\r\n?/g, '\n').split(/\n[ \t]*\n(?:[ \t]*\n)*/)
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
          <div key={i} className="whatsapp-quotes-group">
            {block.text.split('\n').filter((l) => l.trim().length > 0).map((line, qIdx) => (
              <blockquote key={qIdx} dir="auto" className="safe-quote whatsapp-bubble-wrap">
                <div className="whatsapp-bubble">
                  <span className="whatsapp-bubble-tail" aria-hidden="true">
                    <svg viewBox="0 0 22 18" fill="currentColor">
                      <path d="M22 0V18H11C7.4 18 3.6 16.4 0.6 13.6C6.2 12.4 8.7 8.7 9.8 4.6C10.6 1.7 15.8 0 22 0Z" />
                    </svg>
                  </span>
                  <div className="whatsapp-bubble-content">
                    {inlineNodes(line)}
                  </div>
                  <span className="whatsapp-checks" aria-hidden="true">
                    <svg viewBox="0 0 16 15" fill="currentColor">
                      <path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.88a.32.32 0 0 1-.484.033l-.358-.325a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l1.32 1.266c.143.14.361.125.484-.033l6.272-8.048a.366.366 0 0 0-.064-.512zm-4.1 0-.478-.372a.365.365 0 0 0-.51.063L4.566 9.88a.32.32 0 0 1-.484.033L1.891 7.769a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l3.013 2.928c.143.14.361.125.484-.033l6.272-8.048a.366.366 0 0 0-.064-.512z" />
                    </svg>
                  </span>
                </div>
              </blockquote>
            ))}
          </div>
        ) : (
          <p key={i} dir="auto">
            {inlineNodes(block.text)}
          </p>
        ),
      )}
    </div>
  )
}
