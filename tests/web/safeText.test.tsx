import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SafeText } from '../../web/components/SafeText'

afterEach(cleanup)

function webSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return webSourceFiles(full)
    return ['.ts', '.tsx', '.js', '.jsx', '.html'].includes(extname(name)) ? [full] : []
  })
}

describe('SafeText', () => {
  it('shows HTML and markdown link syntax as literal text', () => {
    const { container } = render(<SafeText text={'<img src=x onerror=1> and [a](http://evil)'} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toBe('<img src=x onerror=1> and [a](http://evil)')
  })

  it('turns a "> " line into a blockquote', () => {
    const { container } = render(<SafeText text={'Intro line\n\n> the quote'} />)
    expect(container.querySelector('blockquote')?.textContent).toBe('the quote')
    expect(container.querySelectorAll('p')).toHaveLength(1)
  })

  it('turns **text** into strong and leaves unmatched stars alone', () => {
    const { container } = render(<SafeText text={'a **b** c **d'} />)
    expect(container.querySelector('strong')?.textContent).toBe('b')
    expect(container.textContent).toBe('a b c **d')
  })

  it('splits paragraphs on blank lines', () => {
    const { container } = render(<SafeText text={'one\n\ntwo\nstill two\n\n\nthree'} />)
    const paragraphs = Array.from(container.querySelectorAll('p')).map((p) => p.textContent)
    expect(paragraphs).toEqual(['one', 'two\nstill two', 'three'])
  })

  it('marks the text direction as auto so Hebrew reads right to left', () => {
    const { container } = render(<SafeText text={'שלום\n\n> ציטוט'} />)
    expect(container.querySelector('.safe-text')?.getAttribute('dir')).toBe('auto')
    for (const el of Array.from(container.querySelectorAll('p, blockquote'))) {
      expect(el.getAttribute('dir')).toBe('auto')
    }
    expect(container.querySelector('blockquote')?.textContent).toBe('ציטוט')
  })

  it('renders nothing for blank text', () => {
    const { container } = render(<SafeText text="   " />)
    expect(container.querySelectorAll('p, blockquote')).toHaveLength(0)
  })
})

describe('web/ source safety', () => {
  it('never uses raw HTML sinks', () => {
    const files = webSourceFiles(join(process.cwd(), 'web'))
    expect(files.length).toBeGreaterThan(5)
    const offenders = files.filter((file) => {
      const source = readFileSync(file, 'utf8')
      return source.includes('dangerouslySetInnerHTML') || source.includes('innerHTML')
    })
    expect(offenders).toEqual([])
  })
})
