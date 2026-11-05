import { useEffect, useState } from 'react'
import type { Message } from '../../src/shared/types'
import { Mascot } from './Mascot'
import { pastelFor } from '../lib/palette'

export interface ReadingScreenProps {
  messages: Message[]
  participants: string[]
  me: string
  /** 0 to 1: how much of the chat has been read so far */
  fraction?: number
  language?: string
  onSkip?: () => void
  onDone?: () => void
}

const WINDOW = 14
const PREVIEW_CHARS = 140
const SWEEP_MS = 2400

/**
 * The reading screen: a dark page with a counter, a gradient bar, a column of the chat's own bubbles
 * and a mascot riding a scan line that moves down with the counter. Shows message text as plain text.
 */
export function ReadingScreen({
  messages,
  participants,
  me,
  fraction = 0,
  language,
  onSkip,
  onDone,
}: ReadingScreenProps) {
  const total = messages.length
  const isHebrew = language === 'Hebrew' || language === 'he'
  const [sweepFraction, setSweepFraction] = useState(0)

  useEffect(() => {
    if (total === 0) {
      onDone?.()
      return
    }

    let start: number | null = null
    let frameId: number
    let doneTimer: ReturnType<typeof setTimeout> | null = null

    const tick = (now: number) => {
      if (start === null) start = now
      const elapsed = now - start
      const p = Math.min(1, elapsed / SWEEP_MS)
      // Smooth cubic ease-out
      const eased = 1 - Math.pow(1 - p, 3)
      setSweepFraction(eased)

      if (p < 1) {
        frameId = requestAnimationFrame(tick)
      } else {
        doneTimer = setTimeout(() => {
          onDone?.()
        }, 250)
      }
    }

    frameId = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frameId)
      if (doneTimer) clearTimeout(doneTimer)
    }
  }, [total, onDone])

  const f = Math.min(1, Math.max(sweepFraction, Math.max(0, fraction)))
  const counted = Math.round(f * total)
  const centre = total === 0 ? 0 : Math.min(total - 1, Math.floor(f * total))
  const from = Math.max(0, centre - WINDOW)
  const visible = messages.slice(from, Math.min(total, centre + WINDOW + 1))
  const colourOf = (sender: string) => {
    const i = participants.indexOf(sender)
    return pastelFor(i < 0 ? 0 : i)
  }

  return (
    <main className="reading" aria-live="off">
      {onSkip && (
        <button
          type="button"
          className="reading-skip-btn"
          onClick={onSkip}
          aria-label={isHebrew ? 'דלג לסיפור' : 'Skip to story'}
        >
          {isHebrew ? 'דלג לסיפור ⏭️' : 'Skip to story ⏭️'}
        </button>
      )}
      <p className="reading-count" role="status">
        <span className="reading-number">{counted.toLocaleString('en-US')}</span>
        <span className="reading-of">
          {isHebrew ? ` מתוך ${total.toLocaleString('he-IL')} הודעות` : ` of ${total.toLocaleString('en-US')} messages`}
        </span>
      </p>
      <div className="reading-track" aria-hidden="true">
        <span style={{ width: `${f * 100}%` }} />
      </div>

      <div className="reading-stage">
        <ol className="reading-col" aria-label="Messages being read">
          {visible.map((m) => {
            const outgoing = m.sender === me
            return (
              <li key={m.id} className={`reading-bubble ${outgoing ? 'is-out' : 'is-in'}`}>
                <span className="reading-sender" style={{ color: colourOf(m.sender) }}>
                  {m.sender}
                </span>
                <span className="reading-text" dir="auto">
                  {m.text.length > PREVIEW_CHARS ? `${m.text.slice(0, PREVIEW_CHARS)}…` : m.text}
                </span>
              </li>
            )
          })}
        </ol>
        <div className="scan-line" style={{ top: '50%' }} aria-hidden="true">
          <div className="scan-mascot">
            <Mascot persona="brandon" size={56} />
          </div>
        </div>
      </div>
    </main>
  )
}
