import type { PersonaId } from '../../src/shared/types'

export interface MascotProps {
  persona: PersonaId
  size?: number
}

const INK = '#111'
const FUR = '#ffe0b8'
const BACKDROP: Record<PersonaId, string> = {
  brandon: '#4a8ff5',
  clara: '#ffc6dc',
  diego: '#bdf2de',
}
const LABEL: Record<PersonaId, string> = {
  brandon: 'Brandon mascot',
  clara: 'Clara the cat, with a flower and heart-shaped glasses',
  diego: 'Diego the cat, in a headband with a whistle',
}

/** Brandon uses the illustrated brand mark; the other personas retain their original artwork. */
export function Mascot({ persona, size = 96 }: MascotProps) {
  if (persona === 'brandon') {
    return <img src="/brand/brandon-mascot.webp" alt={LABEL.brandon} width={size} height={size} className="mascot" data-persona="brandon" />
  }
  return (
    <svg
      role="img"
      aria-label={LABEL[persona]}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      className="mascot"
      data-persona={persona}
    >
      <circle cx="60" cy="60" r="58" fill={BACKDROP[persona]} />
      <path d="M26 54 L32 18 L54 38 Z" fill={FUR} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      <path d="M94 54 L88 18 L66 38 Z" fill={FUR} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      <ellipse cx="60" cy="68" rx="36" ry="32" fill={FUR} stroke={INK} strokeWidth="3" />
      <path
        d="M22 72 L40 74 M22 82 L40 80 M98 72 L80 74 M98 82 L80 80"
        stroke={INK}
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M55 74 L65 74 L60 80 Z" fill="#ff8fb1" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      {persona === 'clara' && <ClaraMouth />}
      {persona === 'diego' && <DiegoMouth />}
      {persona === 'clara' && <ClaraFace />}
      {persona === 'diego' && <DiegoFace />}
    </svg>
  )
}

function Eyes() {
  return (
    <g fill={INK}>
      <circle cx="46" cy="66" r="3.5" />
      <circle cx="74" cy="66" r="3.5" />
    </g>
  )
}

function ClaraMouth() {
  return <path d="M50 86 Q60 94 70 86" stroke={INK} strokeWidth="2.5" strokeLinecap="round" fill="none" />
}

function ClaraFace() {
  const heart = 'M46 74 C36 66 34 60 38 58 C42 56 45 59 46 62 C47 59 50 56 54 58 C58 60 56 66 46 74 Z'
  return (
    <g>
      <g fill="#ff5c8a" stroke={INK} strokeWidth="2.5" strokeLinejoin="round">
        <path d={heart} />
        <path d={heart} transform="translate(28 0)" />
      </g>
      <path d="M54 64 Q60 60 66 64" stroke={INK} strokeWidth="2.5" fill="none" />
      {/* flower on the right ear */}
      <g transform="translate(94 26)">
        <g fill="#fff" stroke={INK} strokeWidth="2">
          <circle cx="0" cy="-6" r="5" />
          <circle cx="6" cy="-2" r="5" />
          <circle cx="4" cy="5" r="5" />
          <circle cx="-4" cy="5" r="5" />
          <circle cx="-6" cy="-2" r="5" />
        </g>
        <circle r="3.5" fill="#ffea70" stroke={INK} strokeWidth="1.5" />
      </g>
    </g>
  )
}

function DiegoMouth() {
  return (
    <g>
      <path d="M48 86 Q60 96 72 86" stroke={INK} strokeWidth="2.5" strokeLinecap="round" fill="none" />
      {/* whistle on a cord */}
      <path d="M72 88 L90 98" stroke={INK} strokeWidth="2" />
      <circle cx="96" cy="100" r="7" fill="#ffea70" stroke={INK} strokeWidth="2.5" />
    </g>
  )
}

function DiegoFace() {
  return (
    <g>
      {/* headband with a bow */}
      <path d="M26 50 Q60 38 94 50" stroke="#2f6fd6" strokeWidth="7" strokeLinecap="round" fill="none" />
      <ellipse cx="92" cy="46" rx="5" ry="3.5" fill="#2f6fd6" stroke={INK} strokeWidth="2" />
      <ellipse cx="98" cy="44" rx="4" ry="3" fill="#2f6fd6" stroke={INK} strokeWidth="2" />
      <Eyes />
    </g>
  )
}
