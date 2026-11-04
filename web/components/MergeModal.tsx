import { useState } from 'react'
import { Modal } from './Modal'
import { LetterAvatar } from './LetterAvatar'
import { pastelFor } from '../lib/palette'

export interface MergeCandidate {
  name: string
  messages: number
}

export interface MergeModalProps {
  candidates: MergeCandidate[]
  onMerge: (from: string[], keep: string) => void
  onClose: () => void
}

/** Pick two or more senders and give them one shared name. */
export function MergeModal({ candidates, onMerge, onClose }: MergeModalProps) {
  const [selected, setSelected] = useState<string[]>([])
  const [keepDraft, setKeepDraft] = useState<string | null>(null)

  const toggle = (name: string) =>
    setSelected((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))

  // Keep the first selected name in list order unless the user picked another one.
  const ordered = candidates.filter((c) => selected.includes(c.name)).map((c) => c.name)
  const keep = keepDraft && ordered.includes(keepDraft) ? keepDraft : (ordered[0] ?? '')
  const canMerge = ordered.length >= 2

  return (
    <Modal titleId="merge-title" title="Merge profiles" onClose={onClose}>
      <div className="stack" style={{ gap: 12 }}>
        <p className="muted small">
          Select the names that belong to the same person. They will all read as one name in the report.
        </p>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 4 }}>
          <legend className="sr-only">People to merge</legend>
          {candidates.map((c, i) => (
            <label key={c.name} className="checkbox-row">
              <input type="checkbox" checked={selected.includes(c.name)} onChange={() => toggle(c.name)} />
              <LetterAvatar name={c.name} colour={pastelFor(i)} />
              <span style={{ flex: 1, overflowWrap: 'anywhere' }}>{c.name}</span>
              <span className="small muted">{c.messages.toLocaleString('en-US')}</span>
            </label>
          ))}
        </fieldset>

        {canMerge && (
          <label className="stack" style={{ gap: 6 }}>
            <span className="small muted">Keep this name</span>
            <select className="field" value={keep} onChange={(e) => setKeepDraft(e.target.value)}>
              {ordered.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          className="btn btn-block"
          disabled={!canMerge}
          onClick={() => onMerge(ordered, keep)}
        >
          {canMerge ? `Merge ${ordered.length} into ${keep}` : 'Select at least two names'}
        </button>
      </div>
    </Modal>
  )
}
