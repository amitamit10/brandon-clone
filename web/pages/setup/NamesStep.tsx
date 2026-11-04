import { useState } from 'react'
import { LetterAvatar } from '../../components/LetterAvatar'
import { pastelFor } from '../../lib/palette'

export interface NamesStepProps {
  participants: string[]
  onRename: (from: string, to: string) => void
}

export function NamesStep({ participants, onRename }: NamesStepProps) {
  return (
    <div className="stack">
      <div>
        <h1 className="step-title">Clean up the names</h1>
        <p className="step-sub">Replace nicknames and emojis with simple first names, so Brandon knows who's who.</p>
      </div>

      <div className="card stack" style={{ gap: 4 }}>
        {participants.map((name, i) => (
          <NameRow key={name} name={name} colour={pastelFor(i)} onRename={onRename} />
        ))}
      </div>

      <p className="small muted">
        If two people end up with the same name, they are merged automatically.
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

  return (
    <div style={{ display: 'grid', gap: 4, padding: '8px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <LetterAvatar name={draft.trim() || name} colour={colour} />
        <input
          key={shakeKey}
          className={`field${invalid ? ' shake' : ''}`}
          aria-label={`Name for ${name}`}
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
      {invalid && <p className="field-error">A name can't be empty.</p>}
    </div>
  )
}
