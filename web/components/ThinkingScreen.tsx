import type { PersonaId } from '../../src/shared/types'
import { Mascot } from './Mascot'
import { PERSONA_NAMES } from '../lib/personas'
import { useI18n } from '../lib/i18n'

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
  const { lang, t } = useI18n()
  const he = lang === 'he'
  const parts = Math.max(0, total - 1)
  const part = Math.min(progress, parts)
  const fraction = total > 0 ? Math.min(1, progress / total) : 0
  const name = he ? (persona === 'brandon' ? t.personas.brandonName : persona === 'clara' ? t.personas.claraName : t.personas.diegoName) : PERSONA_NAMES[persona]
  const caption = retrying
    ? (he ? 'המודל עסוק כרגע. מנסים שוב…' : 'A busy moment with the model. Retrying…')
    : parts > 0 && part < parts
      ? (he ? `קורא חלק ${part} מתוך ${parts}` : `Reading part ${part} of ${parts}`)
      : (he ? 'כותב את הדוח' : 'Writing the report')

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
      <h1 className="shimmer">{he ? `${name} חושב…` : `${name} is thinking…`}</h1>
      <p className="small muted">{he ? 'הדוח אמור להופיע בתוך כשתי דקות.' : 'Your report should appear in under 2 min.'}</p>
      <div className="think-track" role="progressbar" aria-label="Report progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={progress}>
        <span style={{ width: `${fraction * 100}%` }} />
      </div>
      <p className="small muted" role="status">
        {caption}
      </p>
    </main>
  )
}
