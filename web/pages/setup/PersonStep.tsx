import { useState } from 'react'
import type { PersonaId } from '../../../src/shared/types'
import { Mascot } from '../../components/Mascot'
import { LANGUAGES, validOtherLanguage } from '../../lib/languages'
import { PERSONAS } from '../../lib/personas'

export interface PersonStepProps {
  participants: string[]
  me: string | null
  onMe: (name: string) => void
  persona: PersonaId
  onPersona: (persona: PersonaId) => void
  /** null while nothing valid is chosen (for example an invalid "Other" entry). */
  language: string | null
  onLanguage: (language: string | null) => void
}

export function PersonStep({
  participants,
  me,
  onMe,
  persona,
  onPersona,
  language,
  onLanguage,
}: PersonStepProps) {
  const [otherOpen, setOtherOpen] = useState(false)
  const [otherText, setOtherText] = useState('')
  const otherInvalid = otherOpen && otherText.trim().length > 0 && validOtherLanguage(otherText) === null

  const pickLanguage = (lang: string) => {
    setOtherOpen(false)
    onLanguage(lang)
  }

  const openOther = () => {
    setOtherOpen(true)
    onLanguage(validOtherLanguage(otherText))
  }

  const changeOther = (raw: string) => {
    setOtherText(raw)
    onLanguage(validOtherLanguage(raw))
  }

  return (
    <div className="stack" style={{ gap: 28 }}>
      <section className="stack" aria-labelledby="me-heading">
        <div>
          <h1 id="me-heading" className="step-title">
            Which one are you?
          </h1>
          <p className="step-sub">Pick yourself from the members, so the report can speak to you directly.</p>
        </div>
        <div className="lang-grid" role="group" aria-label="Members">
          {participants.map((name) => (
            <button
              key={name}
              type="button"
              className="pill"
              aria-pressed={me === name}
              onClick={() => onMe(name)}
            >
              {name}
            </button>
          ))}
        </div>
      </section>

      <section className="stack" aria-labelledby="persona-heading">
        <div>
          <h2 id="persona-heading" className="step-title" style={{ fontSize: '1.4rem' }}>
            Pick your persona
          </h2>
          <p className="step-sub">Who writes the report?</p>
        </div>
        <div className="stack" style={{ gap: 10 }} role="group" aria-label="Persona">
          {PERSONAS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="persona-card"
              aria-pressed={persona === p.id}
              onClick={() => onPersona(p.id)}
            >
              <Mascot persona={p.id} size={72} />
              <strong style={{ fontSize: '1.05rem' }}>{p.name}</strong>
              <span className="small muted">{p.tagline}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="stack" aria-labelledby="lang-heading">
        <div>
          <h2 id="lang-heading" className="step-title" style={{ fontSize: '1.4rem' }}>
            Report language
          </h2>
          <p className="step-sub">It can differ from your chat.</p>
        </div>
        <div className="lang-grid" role="group" aria-label="Report language">
          {LANGUAGES.map((lang) => (
            <button
              key={lang}
              type="button"
              className="pill"
              aria-pressed={!otherOpen && language === lang}
              onClick={() => pickLanguage(lang)}
            >
              {lang}
            </button>
          ))}
          <button type="button" className="pill" aria-pressed={otherOpen} onClick={openOther}>
            Other
          </button>
        </div>
        {otherOpen && (
          <div className="stack" style={{ gap: 6 }}>
            <label className="stack" style={{ gap: 6 }}>
              <span className="small muted">Other language</span>
              <input
                className={`field${otherInvalid ? ' shake' : ''}`}
                type="text"
                value={otherText}
                maxLength={40}
                placeholder="e.g. Swahili"
                aria-invalid={otherInvalid}
                aria-describedby="other-help"
                onChange={(e) => changeOther(e.target.value)}
              />
            </label>
            <p id="other-help" className={otherInvalid ? 'field-error' : 'small muted'}>
              {otherInvalid ? 'Use 2 to 40 letters or spaces, no numbers.' : 'Use 2 to 40 letters or spaces.'}
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
