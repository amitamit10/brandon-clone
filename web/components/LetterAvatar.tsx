import { initialOf } from '../lib/palette'

export function LetterAvatar({ name, colour }: { name: string; colour: string }) {
  return (
    <span className="letter-avatar" style={{ background: colour }} aria-hidden="true">
      {initialOf(name)}
    </span>
  )
}
