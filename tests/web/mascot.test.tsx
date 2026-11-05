import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Mascot } from '../../web/components/Mascot'
afterEach(cleanup)
it('renders the new Brandon mark with an accessible name and requested size', () => {
  render(<Mascot persona="brandon" size={48} />)
  const logo = screen.getByRole('img', { name: 'Brandon mascot' })
  expect(logo.getAttribute('src')).toBe('/brand/brandon-mascot.webp')
  expect(logo.getAttribute('width')).toBe('48')
})
