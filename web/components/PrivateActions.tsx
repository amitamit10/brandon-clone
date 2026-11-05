import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PersonaId } from '../../src/shared/types'
import { createReport, deleteChat, deleteReport, shareReport, unshareReport, type CreateReportBody } from '../lib/api'
import { addHistory, removeChat, removeReport } from '../lib/history'
import { apiErrorMessage } from '../lib/messages'
import { useI18n } from '../lib/i18n'

export const QUESTION_MAX = 500

/** Everything a follow-up or deep dive needs from the first report. */
export interface ReaderSettings {
  chatId: string
  name: string
  persona: PersonaId
  language: string
  me: string
}

export function reportPath(chatId: string, reportId: string): string {
  return `/c/${encodeURIComponent(chatId)}/reports/${encodeURIComponent(reportId)}`
}

/** Creates a report from the stored settings, remembers it in history, and returns its id. */
export async function startReport(settings: ReaderSettings, body: CreateReportBody): Promise<string> {
  const reportId = await createReport(settings.chatId, body)
  addHistory({
    chatId: settings.chatId,
    reportId,
    name: settings.name,
    createdAt: Date.now(),
    persona: body.persona,
    language: body.language,
    me: settings.me,
    kind: body.kind,
    ...(body.kind === 'member' ? { subject: body.subject } : {}),
  })
  return reportId
}

/** Share, copy and stop sharing. The link is /s/<shareId> on this origin. */
export function ShareBox({ reportId }: { reportId: string }) {
  const { t, lang } = useI18n()
  const [shareId, setShareId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(0)
  const link = shareId ? `${window.location.origin}/s/${shareId}` : ''

  const share = async () => {
    setBusy(true)
    setError(null)
    try {
      setShareId(await shareReport(reportId))
    } catch (e) {
      setError(apiErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied((n) => n + 1)
    } catch {
      setError(lang === 'he' ? 'ההעתקה לא עבדה כאן. סמנו את הקישור והעתיקו.' : 'Copying did not work here. Select the link and copy it.')
    }
  }

  const stop = async () => {
    setBusy(true)
    setError(null)
    try {
      await unshareReport(reportId)
      setShareId(null)
    } catch (e) {
      setError(apiErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (!shareId) {
    return (
      <div className="stack" style={{ gap: 8 }}>
        <button type="button" className="btn btn-block" onClick={share} disabled={busy}>
          {busy ? (lang === 'he' ? t.report.makingLink : 'Making the link…') : (lang === 'he' ? t.report.shareTheReport : 'Share the report')}
        </button>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
      </div>
    )
  }

  return (
    <section className="card stack share-box" style={{ gap: 10 }} aria-labelledby="share-heading">
      <h2 id="share-heading" className="report-h3">
        {lang === 'he' ? t.report.yourLink : 'Your link'}
      </h2>
      <p className="small muted">
        {lang === 'he' ? 'כל מי שיש לו קישור זה יכול לצפות בדוח. שום דבר אחר אינו משותף.' : 'Anyone with this link can read the report. Nothing else is shared.'}
      </p>
      <div className="share-link">
        <code className="share-url">{link}</code>
      </div>
      <div className="row-actions">
        <button
          key={copied}
          type="button"
          className={`btn${copied > 0 ? ' hop' : ''}`}
          onClick={copy}
          aria-live="polite"
        >
          {copied > 0 ? (lang === 'he' ? t.report.copied : 'Copied') : (lang === 'he' ? t.report.copyLink : 'Copy link')}
        </button>
        <button type="button" className="btn btn-ghost" onClick={stop} disabled={busy}>
          {busy ? (lang === 'he' ? 'מפסיק…' : 'Stopping…') : (lang === 'he' ? t.report.stopSharing : 'Stop sharing')}
        </button>
      </div>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </section>
  )
}

/** A follow-up question, which becomes a new report on the same chat. */
export function FollowUpBox({ settings }: { settings: ReaderSettings }) {
  const navigate = useNavigate()
  const { t, lang } = useI18n()
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmed = question.trim()
  const valid = trimmed.length > 0 && trimmed.length <= QUESTION_MAX

  const ask = async () => {
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      const reportId = await startReport(settings, {
        persona: settings.persona,
        language: settings.language,
        me: settings.me,
        kind: 'followup',
        question: trimmed,
      })
      navigate(reportPath(settings.chatId, reportId))
    } catch (e) {
      setError(apiErrorMessage(e))
      setBusy(false)
    }
  }

  return (
    <section id="ask" className="card stack" style={{ gap: 10 }} aria-labelledby="ask-heading">
      <h2 id="ask-heading" className="report-h3">
        {lang === 'he' ? 'שאלו שאלה מעמיקה' : 'Ask a deeper question'}
      </h2>
      <label className="stack" style={{ gap: 6 }}>
        <span className="small muted">
          {lang === 'he' ? 'ברנדון יקרא שוב את כל השיחה כדי לענות לכם.' : 'Brandon reads the whole chat again for this one.'}
        </span>
        <textarea
          className="field"
          rows={3}
          maxLength={QUESTION_MAX}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          aria-describedby="ask-count"
          placeholder={lang === 'he' ? 'למשל: מי תמיד חייב להגיד את המילה האחרונה?' : 'Who always has the last word?'}
        />
      </label>
      <div className="row-actions" style={{ justifyContent: 'space-between' }}>
        <span id="ask-count" className="small muted" aria-live="polite">
          {question.length}/{QUESTION_MAX}
        </span>
        <button type="button" className="btn" onClick={ask} disabled={!valid || busy}>
          {busy ? (lang === 'he' ? 'חושב…' : 'Starting…') : (lang === 'he' ? 'שאלו את ברנדון' : 'Ask Brandon')}
        </button>
      </div>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </section>
  )
}

/** A deep dive on one member, created as a 'member' report. Only the report's own names are offered. */
export function DeepDiveButton({ settings, name }: { settings: ReaderSettings; name: string }) {
  const navigate = useNavigate()
  const { lang, t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      const reportId = await startReport(settings, {
        persona: settings.persona,
        language: settings.language,
        me: settings.me,
        kind: 'member',
        subject: name,
      })
      navigate(reportPath(settings.chatId, reportId))
    } catch (e) {
      setError(apiErrorMessage(e))
      setBusy(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        className="link-btn"
        onClick={go}
        disabled={busy}
        aria-label={lang === 'he' ? `ניתוח עומק על ${name}` : `Deep dive on ${name}`}
      >
        {busy ? (lang === 'he' ? 'מתחיל…' : 'Starting…') : (lang === 'he' ? t.report.deepDive : 'Deep dive')}
      </button>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </div>
  )
}

/** A button that asks for a second, inline confirmation. No window.confirm. */
export function ConfirmButton({
  label,
  question,
  confirmLabel,
  onConfirm,
  busy,
}: {
  label: string
  question: string
  confirmLabel: string
  onConfirm: () => void
  busy?: boolean
}) {
  const { lang } = useI18n()
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button type="button" className="btn btn-ghost btn-danger" onClick={() => setOpen(true)} disabled={busy}>
        {label}
      </button>
    )
  }
  return (
    <div className="confirm" role="group" aria-label={question}>
      <p className="small">{question}</p>
      <div className="row-actions">
        <button type="button" className="btn btn-danger-solid" onClick={onConfirm} disabled={busy}>
          {busy ? (lang === 'he' ? 'מוחק…' : 'Deleting…') : confirmLabel}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>
          {lang === 'he' ? 'ביטול' : 'Cancel'}
        </button>
      </div>
    </div>
  )
}

/** Delete one report (back to the chat hub), or the whole chat (back to history). */
export function DeleteBox({ settings, reportId }: { settings: ReaderSettings; reportId: string }) {
  const navigate = useNavigate()
  const { lang, t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (kind: 'report' | 'chat') => {
    setBusy(true)
    setError(null)
    try {
      if (kind === 'report') {
        await deleteReport(reportId)
        removeReport(reportId)
        navigate(`/c/${encodeURIComponent(settings.chatId)}`)
      } else {
        await deleteChat(settings.chatId)
        removeChat(settings.chatId)
        navigate('/history')
      }
    } catch (e) {
      if (isNotFound(e)) {
        if (kind === 'report') removeReport(reportId)
        else removeChat(settings.chatId)
        navigate(kind === 'report' ? `/c/${encodeURIComponent(settings.chatId)}` : '/history')
        return
      }
      setError(apiErrorMessage(e))
      setBusy(false)
    }
  }

  return (
    <section className="stack" style={{ gap: 10 }} aria-labelledby="delete-heading">
      <h2 id="delete-heading" className="small muted" style={{ fontWeight: 700 }}>
        {lang === 'he' ? t.report.deleteBtn : 'Delete'}
      </h2>
      <div className="row-actions">
        <ConfirmButton
          label={lang === 'he' ? t.report.deleteReport : 'Delete this report'}
          question={lang === 'he' ? t.report.deleteQuestion : 'Delete this report for good?'}
          confirmLabel={lang === 'he' ? t.report.yesDelete : 'Yes, delete report'}
          busy={busy}
          onConfirm={() => run('report')}
        />
        <ConfirmButton
          label={lang === 'he' ? t.hub.deleteTheChat : 'Delete the chat'}
          question={lang === 'he' ? t.hub.deleteChatQuestion : 'Delete the whole chat and all its reports?'}
          confirmLabel={lang === 'he' ? t.hub.confirmDelete : 'Yes, delete chat'}
          busy={busy}
          onConfirm={() => run('chat')}
        />
      </div>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </section>
  )
}

function isNotFound(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { status?: unknown }).status === 404
}
