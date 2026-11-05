import { useState } from 'react'
import { LetterAvatar } from '../../components/LetterAvatar'
import { pastelFor } from '../../lib/palette'
import { useI18n } from '../../lib/i18n'

export interface NamesStepProps {
  participants: string[]
  onRename: (from: string, to: string) => void
}

export function NamesStep({ participants, onRename }: NamesStepProps) {
  const { t } = useI18n()
  return (
    <div className="stack">
      <div>
        <h1 className="step-title">{t.setup.cleanNamesTitle}</h1>
        <p className="step-sub">{t.setup.cleanNamesSub}</p>
      </div>

      <div className="card stack" style={{ gap: 4 }}>
        {participants.map((name, i) => (
          <NameRow key={name} name={name} colour={pastelFor(i)} onRename={onRename} />
        ))}
      </div>

      <p className="small muted">
        {t.setup.namesAutoMerged}
      </p>
    </div>
  )
}

function NameRow({
  name,
  colour,
  onRename,
}: {
  name: string
  colour: string
  onRename: (from: string, to: string) => void
}) {
  const { t, lang } = useI18n()
  const [draft, setDraft] = useState(name)
  const [invalid, setInvalid] = useState(false)
  const [shakeKey, setShakeKey] = useState(0)

  const commit = () => {
    const next = draft.trim()
    if (next.length === 0) {
      setDraft(name)
      setInvalid(true)
      setShakeKey((k) => k + 1)
      return
    }
    setInvalid(false)
    if (next !== name) onRename(name, next)
  }

  const label = lang === 'en' ? `Name for ${name}` : t.setup.nameFor.replace('{name}', name)

  return (
    <div style={{ display: 'grid', gap: 4, padding: '8px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <LetterAvatar name={draft.trim() || name} colour={colour} />
        <input
          key={shakeKey}
          className={`field${invalid ? ' shake' : ''}`}
          aria-label={label}
          aria-invalid={invalid}
          value={draft}
          maxLength={40}
          onChange={(e) => {
            setInvalid(false)
            setDraft(e.target.value)
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
          }}
        />
      </div>
      {invalid && <p className="field-error">{t.setup.nameCantBeEmpty}</p>}
    </div>
  )
}
