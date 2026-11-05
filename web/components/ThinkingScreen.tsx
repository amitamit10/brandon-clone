import type { PersonaId } from '../../src/shared/types'
import { Mascot } from './Mascot'
import { PERSONA_NAMES } from '../lib/personas'

export interface ThinkingScreenProps {
  persona: PersonaId
  progress: number
  total: number
  /** the last answer was rate_limited or another retryable error */
  retrying: boolean
}

const ORBIT_COLOURS = ['#ffc6dc', '#ffeaa7', '#bdf2de', '#d9ccff', '#ffd2b8', '#4a8ff5'] as const

/**
 * The waiting screen while the report is written: the mascot in a rainbow halo with dots orbiting,
 * a shimmering line, a gradient bar from real job progress, and a caption with the part count.
 */
export function ThinkingScreen({ persona, progress, total, retrying }: ThinkingScreenProps) {
  const parts = Math.max(0, total - 1)
  const part = Math.min(progress, parts)
  const fraction = total > 0 ? Math.min(1, progress / total) : 0
  const name = PERSONA_NAMES[persona]
  const caption = retrying
    ? 'A busy moment with the model. Retrying…'
    : parts > 0 && part < parts
      ? `Reading part ${part} of ${parts}`
      : 'Writing the report'

  return (
    <main className="thinking" aria-live="polite">
      <div className="thinking-mascot">
        <span className="halo-rainbow" aria-hidden="true" />
        <span className="orbit" aria-hidden="true">
          {ORBIT_COLOURS.map((c, i) => (
            <span key={i} className="orbit-dot" style={{ background: c, transform: `rotate(${i * 60}deg) translateY(-72px)` }} />
          ))}
        </span>
        <Mascot persona={persona} size={120} />
        <span className="think-badge" aria-hidden="true">
          🤔
        </span>
      </div>
      <h1 className="shimmer">{name} is thinking…</h1>
      <p className="small muted">Your report should appear in under 2 min.</p>
      <div className="think-track" role="progressbar" aria-label="Report progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={progress}>
        <span style={{ width: `${fraction * 100}%` }} />
      </div>
      <p className="small muted" role="status">
        {caption}
      </p>
    </main>
  )
}
