import type { ReactNode } from 'react'

/**
 * Renders a small subset of report text as React text nodes: paragraphs (blank lines), '> ' quotes and
 * **bold**. No HTML is ever parsed, and there are no links or images.
 */
export function SafeText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim().length > 0)
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split('\n')
        if (lines.every((l) => l.startsWith('> '))) {
          return <blockquote key={i}>{lines.map((l) => l.slice(2)).join('\n')}</blockquote>
        }
        return <p key={i}>{bold(block)}</p>
      })}
    </>
  )
}

/** Splits **bold** runs into <strong> text nodes. Everything else stays plain text. */
function bold(line: string): ReactNode[] {
  return line.split(/(\*\*[^*\n]+\*\*)/).map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  )
}
