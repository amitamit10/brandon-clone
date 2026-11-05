import { useState } from 'react'
import type { PersonaId } from '../../../src/shared/types'
import { Mascot } from '../../components/Mascot'
import { LANGUAGES, validOtherLanguage } from '../../lib/languages'
import { PERSONAS } from '../../lib/personas'
import { useI18n } from '../../lib/i18n'

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
  const { t, lang: appLang } = useI18n()
  const [otherOpen, setOtherOpen] = useState(false)
  const [otherText, setOtherText] = useState('')
  const otherInvalid = otherOpen && otherText.trim().length > 0 && validOtherLanguage(otherText) === null

  const personaLabel = (id: PersonaId) => {
    if (appLang === 'he') {
      if (id === 'brandon') return { name: t.personas.brandonName, tagline: t.personas.brandonTagline }
      if (id === 'clara') return { name: t.personas.claraName, tagline: t.personas.claraTagline }
      return { name: t.personas.diegoName, tagline: t.personas.diegoTagline }
    }
    const found = PERSONAS.find((p) => p.id === id)
    return { name: found?.name ?? id, tagline: found?.tagline ?? '' }
  }

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
            {t.setup.whichOneAreYouTitle}
          </h1>
          <p className="step-sub">{t.setup.whichOneAreYouSub}</p>
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
            {t.setup.pickPersonaTitle}
          </h2>
          <p className="step-sub">{appLang === 'he' ? 'דוח ברנדון תקיף וביקורתי עם מדד האורה המלא' : 'Brandon-only mode with the full Aura Check'}</p>
        </div>
        <div className="stack" style={{ gap: 10 }} role="group" aria-label="Persona">
          <button
            type="button"
            className="persona-card"
            aria-pressed="true"
            onClick={() => onPersona('brandon')}
            style={{ borderColor: 'var(--accent, #ff4081)' }}
          >
            <Mascot persona="brandon" size={72} />
            <div className="stack" style={{ gap: 4, textAlign: 'inherit' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '1.1rem' }}>{personaLabel('brandon').name}</strong>
                <span className="badge" style={{ background: '#7928ca', color: '#fff', fontSize: '0.75rem', padding: '2px 8px', borderRadius: 12, fontWeight: 700 }}>
                  Aura Edition ⚡
                </span>
              </div>
              <span className="small muted">{personaLabel('brandon').tagline}</span>
            </div>
          </button>
        </div>
      </section>

      <section className="stack" aria-labelledby="lang-heading">
        <div>
          <h2 id="lang-heading" className="step-title" style={{ fontSize: '1.4rem' }}>
            {t.setup.reportLanguageTitle}
          </h2>
          <p className="step-sub">{t.setup.reportLanguageSub}</p>
        </div>
        <div className="lang-grid" role="group" aria-label="Report language">
          {LANGUAGES.map((l) => (
            <button
              key={l}
              type="button"
              className="pill"
              aria-pressed={!otherOpen && language === l}
              onClick={() => pickLanguage(l)}
            >
              {l}
            </button>
          ))}
          <button type="button" className="pill" aria-pressed={otherOpen} onClick={openOther}>
            {t.setup.other}
          </button>
        </div>
        {otherOpen && (
          <div className="stack" style={{ gap: 6 }}>
            <label className="stack" style={{ gap: 6 }}>
              <span className="small muted">{t.setup.otherLanguage}</span>
              <input
                className={`field${otherInvalid ? ' shake' : ''}`}
                type="text"
                value={otherText}
                maxLength={40}
                placeholder={t.setup.otherPlaceholder}
                aria-invalid={otherInvalid}
                aria-describedby="other-help"
                onChange={(e) => changeOther(e.target.value)}
              />
            </label>
            <p id="other-help" className={otherInvalid ? 'field-error' : 'small muted'}>
              {otherInvalid ? t.setup.otherInvalid : t.setup.otherHelp}
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
