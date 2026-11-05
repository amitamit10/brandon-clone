import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PersonaId } from '../../../src/shared/types'
import type { Analyzed } from '../../lib/analyze'
import { createReport, uploadChat } from '../../lib/api'
import { addHistory } from '../../lib/history'
import { apiErrorMessage } from '../../lib/messages'
import { PERSONA_NAMES } from '../../lib/personas'
import { PRIVACY_TEXT } from '../../components/PrivacyNote'
import { cleanName, saveUploaderName } from '../../lib/uploaderName'

export interface StartStepProps {
  groupName: string
  analysed: Analyzed
  me: string | null
  persona: PersonaId
  language: string | null
  uploaderName: string
}

export function StartStep({ groupName, analysed, me, persona, language, uploaderName }: StartStepProps) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Kept across retries so a failed report call does not upload the chat a second time.
  const savedChatId = useRef<string | null>(null)
  const name = groupName.trim()
  const ready = name.length > 0 && me !== null && language !== null

  const start = async () => {
    if (!ready || me === null || language === null) return
    setBusy(true)
    setError(null)
    try {
      let chatId = savedChatId.current
      if (!chatId) {
        chatId = await uploadChat({
          name,
          uploaderName: cleanName(uploaderName),
          participants: analysed.chat.participants,
          stats: analysed.stats,
          chunks: analysed.chunks,
        })
        savedChatId.current = chatId
        // Remembered for the next visit, only once the upload has succeeded.
        saveUploaderName(uploaderName)
      }
      const reportId = await createReport(chatId, { persona, language, me, kind: 'group' })
      // Ids and a name only. The chat text never leaves memory in the browser.
      addHistory({ chatId, reportId, name, createdAt: Date.now() })
      navigate(`/c/${encodeURIComponent(chatId)}/reports/${encodeURIComponent(reportId)}`)
    } catch (e) {
      setError(apiErrorMessage(e))
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <div>
        <h1 className="step-title">Ready when you are</h1>
        <p className="step-sub">Check the details, then start the report.</p>
      </div>

      <section className="card stack" style={{ gap: 10 }} aria-label="Summary">
        <SummaryRow label="Group" value={name || '—'} />
        <SummaryRow label="Members" value={String(analysed.chat.participants.length)} />
        <SummaryRow label="Messages" value={analysed.messageCount.toLocaleString('en-US')} />
        <SummaryRow label="You are" value={me ?? '—'} />
        <SummaryRow label="Persona" value={PERSONA_NAMES[persona]} />
        <SummaryRow label="Language" value={language ?? '—'} />
      </section>

      {error && (
        <p role="alert" className="field-error shake">
          {error}
        </p>
      )}

      <button
        type="button"
        className="btn btn-dark glow btn-block"
        style={{ marginTop: 8 }}
        disabled={!ready || busy}
        onClick={start}
      >
        {busy ? 'Creating your report…' : 'Create my report'}
      </button>
      <p className="small muted" style={{ textAlign: 'center' }}>
        {PRIVACY_TEXT}
      </p>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span className="muted">{label}</span>
      <strong style={{ textAlign: 'right', overflowWrap: 'anywhere' }}>{value}</strong>
    </div>
  )
}
