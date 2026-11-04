import { useMemo, useState } from 'react'
import type { Analyzed } from '../../lib/analyze'
import { pastelFor } from '../../lib/palette'
import { MergeModal, type MergeCandidate } from '../../components/MergeModal'

export interface MembersStepProps {
  analysed: Analyzed
  groupName: string
  onGroupName: (name: string) => void
  onMerge: (from: string[], keep: string) => void
}

export function MembersStep({ analysed, groupName, onGroupName, onMerge }: MembersStepProps) {
  const [mergeOpen, setMergeOpen] = useState(false)
  const { stats, chat } = analysed

  const ranked = useMemo(() => {
    const total = stats.total || 1
    return chat.participants
      .map((name, i) => {
        const messages = stats.perMember[name]?.messages ?? 0
        return { name, messages, percent: (messages / total) * 100, colour: pastelFor(i) }
      })
      .sort((a, b) => b.messages - a.messages)
  }, [chat.participants, stats])

  const candidates: MergeCandidate[] = ranked.map((r) => ({ name: r.name, messages: r.messages }))

  return (
    <div className="stack">
      <div>
        <h1 className="step-title">Check the group</h1>
        <p className="step-sub">Name the group, then make sure each person shows up only once.</p>
      </div>

      <label className="stack" style={{ gap: 6 }}>
        <span className="sr-only">Group name</span>
        <span className="field-wrap" style={{ position: 'relative' }}>
          <input
            className="field"
            style={{ paddingRight: 44 }}
            type="text"
            value={groupName}
            maxLength={60}
            placeholder="Name this group…"
            onChange={(e) => onGroupName(e.target.value)}
          />
          <span aria-hidden="true" style={{ position: 'absolute', right: 14, top: 12, fontSize: 18 }}>
            ✎
          </span>
        </span>
      </label>

      <section className="card" aria-labelledby="ranking-heading">
        <h2 id="ranking-heading" className="small muted" style={{ fontWeight: 700, marginBottom: 4 }}>
          {analysed.messageCount.toLocaleString('en-US')} messages from {ranked.length} people
        </h2>
        {ranked.map((r) => (
          <div key={r.name} className="member-row">
            <span className="dot" style={{ background: r.colour }} aria-hidden="true" />
            <div style={{ minWidth: 0 }}>
              <strong style={{ overflowWrap: 'anywhere' }}>{r.name}</strong>
              <div className="bar-track" aria-hidden="true">
                <span style={{ width: `${r.percent}%`, background: r.colour }} />
              </div>
            </div>
            <span className="small" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
              {r.messages.toLocaleString('en-US')}
              <span className="muted"> · {Math.round(r.percent)}%</span>
            </span>
          </div>
        ))}
      </section>

      <section className="card stack" style={{ gap: 10 }} aria-labelledby="dupes-heading">
        <h2 id="dupes-heading" style={{ fontSize: '1.05rem' }}>
          Make sure each person appears only once
        </h2>
        <p className="small muted">
          Someone who shows up under two names or numbers should be merged into one person.
        </p>
        <button type="button" className="btn btn-ghost" onClick={() => setMergeOpen(true)}>
          Merge profiles
        </button>
      </section>

      {mergeOpen && (
        <MergeModal
          candidates={candidates}
          onClose={() => setMergeOpen(false)}
          onMerge={(from, keep) => {
            onMerge(from, keep)
            setMergeOpen(false)
          }}
        />
      )}
    </div>
  )
}
