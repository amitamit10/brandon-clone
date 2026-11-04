import type { CSSProperties } from 'react'
import { Mascot } from './Mascot'

type Slot =
  | { kind: 'persona'; persona: 'brandon' | 'clara' | 'diego'; x: number; y: number; size: number }
  | { kind: 'emoji'; emoji: string; x: number; y: number; size: number }

/** Positions are percentages of the cluster box, relative to its centre. */
const SLOTS: Slot[] = [
  { kind: 'persona', persona: 'brandon', x: 0, y: 0, size: 96 },
  { kind: 'persona', persona: 'clara', x: 34, y: -6, size: 56 },
  { kind: 'emoji', emoji: '🐸', x: 22, y: 28, size: 52 },
  { kind: 'persona', persona: 'diego', x: -10, y: 34, size: 56 },
  { kind: 'emoji', emoji: '🦊', x: -36, y: 8, size: 52 },
  { kind: 'emoji', emoji: '🐼', x: -22, y: -30, size: 52 },
  { kind: 'emoji', emoji: '🐙', x: 14, y: -34, size: 52 },
]

const RING_COUNT = 7

/** Rippling rings behind a cluster of mascots and emoji avatars. */
export function RingCluster() {
  return (
    <div className="cluster" aria-hidden="true">
      <div className="cluster-rings">
        {Array.from({ length: RING_COUNT }, (_, i) => (
          <span key={i} className="ring" style={{ '--i': i } as CSSProperties} />
        ))}
      </div>
      <div className="cluster-avatars">
        {SLOTS.map((slot, i) => (
          <span
            key={i}
            className="avatar-slot"
            style={
              {
                '--x': slot.x,
                '--y': slot.y,
                '--s': `${slot.size}px`,
                '--i': i,
              } as CSSProperties
            }
          >
            {slot.kind === 'persona' ? <Mascot persona={slot.persona} size={slot.size} /> : slot.emoji}
          </span>
        ))}
      </div>
    </div>
  )
}
