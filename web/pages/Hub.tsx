import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Mascot } from '../components/Mascot'
import { ConfirmButton } from '../components/PrivateActions'
import { deleteChat, getReport, type ReportStatus, type ReportView } from '../lib/api'
import { historyForChat, removeChat, type HistoryEntry } from '../lib/history'
import { pastelFor } from '../lib/palette'
import { PERSONA_NAMES } from '../lib/personas'
import { sessionFor } from '../lib/session'
import { apiErrorMessage } from '../lib/messages'
import { useI18n } from '../lib/i18n'
import { LanguageToggle } from '../components/LanguageToggle'
import type { PersonaId } from '../../src/shared/types'

/** What the hub knows about one report, from the server, or 'gone' when it was deleted. */
type Row =
  | { state: 'loading' }
  | { state: 'ok'; status: ReportStatus; title: string; persona: PersonaId }
  | { state: 'gone' }
  | { state: 'error' }

const MAX_FETCHED = 20

const STATUS_LABEL: Record<ReportStatus, string> = {
  queued: 'Starting',
  running: 'Writing',
  done: 'Ready',
  failed: 'Stopped',
}

export function Hub() {
  const { t, lang } = useI18n()
  const { chatId = '' } = useParams()
  const navigate = useNavigate()
  const [entries] = useState<HistoryEntry[]>(() => historyForChat(chatId))
  const [session] = useState(() => sessionFor(chatId))
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [members, setMembers] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const name = session?.groupName ?? entries[0]?.name ?? 'Chat'
  const participants = session ? session.chat.participants : members
  const latest = entries[0]

  useEffect(() => {
    let cancelled = false
    const toLoad = entries.slice(0, MAX_FETCHED)
    setRows(Object.fromEntries(toLoad.map((e) => [e.reportId, { state: 'loading' } as Row])))
    for (const entry of toLoad) {
      getReport(entry.reportId)
        .then((view: ReportView) => {
          if (cancelled) return
          const title = view.content?.title ?? ''
          setRows((prev) => ({ ...prev, [entry.reportId]: { state: 'ok', status: view.status, title, persona: view.persona } }))
          if (!session && view.status === 'done' && view.content && members === null) {
            setMembers(view.content.members.map((m) => m.name).filter((n) => n.length > 0))
          }
        })
        .catch((e: unknown) => {
          if (cancelled) return
          const gone = typeof e === 'object' && e !== null && (e as { status?: unknown }).status === 404
          setRows((prev) => ({ ...prev, [entry.reportId]: gone ? { state: 'gone' } : { state: 'error' } }))
        })
    }
    return () => {
      cancelled = true
    }
    // The entries are read once on mount; the hub does not follow later storage changes.
  }, [chatId])

  const removeAll = async () => {
    setBusy(true)
    setError(null)
    try {
      await deleteChat(chatId)
    } catch (e) {
      if (!(typeof e === 'object' && e !== null && (e as { status?: unknown }).status === 404)) {
        setError(apiErrorMessage(e))
        setBusy(false)
        return
      }
    }
    removeChat(chatId)
    navigate('/history')
  }

  const peopleCountText = participants
    ? `${participants.length} ${participants.length === 1 ? t.hub.person : t.hub.people} · `
    : ''
  const reportsCountText = `${entries.length} ${entries.length === 1 ? t.hub.report : t.hub.reportsCount}`

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/history" className="icon-btn" aria-label={t.nav.allChats}>
            ←
          </Link>
          <span className="wordmark">Brandon Clone</span>
          <span className="topbar-spacer" />
          <LanguageToggle />
        </div>
      </header>

      <main className="wrap hub stack" style={{ gap: 24, paddingTop: 16, paddingBottom: 48 }}>
        <section className="tile tile-lilac hub-head" aria-labelledby="hub-title">
          <h1 id="hub-title" className="display-serif hub-title">
            {name}
          </h1>
          <p className="small">
            {peopleCountText}
            {reportsCountText}
          </p>
          {latest ? (
            <Link className="btn btn-block" to={`/c/${encodeURIComponent(chatId)}/reports/${encodeURIComponent(latest.reportId)}#ask`}>
              {t.hub.newReportOnChat}
            </Link>
          ) : (
            <Link className="btn btn-block" to="/setup">
              {t.hub.uploadAChat}
            </Link>
          )}
        </section>

        <section className="stack" style={{ gap: 12 }} aria-labelledby="timeline-heading">
          <h2 id="timeline-heading" className="report-h2">
            {t.hub.reports}
          </h2>
          {entries.length === 0 && (
            <p className="muted small">{t.hub.noReports}</p>
          )}
          <ol className="timeline">
            {entries.map((entry, i) => {
              const row = rows[entry.reportId] ?? { state: 'loading' }
              const persona: PersonaId = row.state === 'ok' ? row.persona : (entry.persona ?? 'brandon')
              const personaName = lang === 'he'
                ? (persona === 'brandon' ? t.personas.brandonName : persona === 'clara' ? t.personas.claraName : t.personas.diegoName)
                : PERSONA_NAMES[persona]
              return (
                <li key={entry.reportId}>
                  <Link className="card timeline-item" to={`/c/${encodeURIComponent(chatId)}/reports/${encodeURIComponent(entry.reportId)}`}>
                    <span className="timeline-num" aria-hidden="true">
                      {entries.length - i}
                    </span>
                    <Mascot persona={persona} size={40} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <strong className="timeline-title">{titleFor(row, entry, t.hub.deletedReport)}</strong>
                      <span className="small muted">
                        {personaName} · {localDay(entry.createdAt)} · {statusText(row)}
                      </span>
                    </span>
                    <span aria-hidden="true">›</span>
                  </Link>
                </li>
              )
            })}
          </ol>
        </section>

        {participants && participants.length > 0 && (
          <section className="stack" style={{ gap: 10 }} aria-labelledby="people-heading">
            <h2 id="people-heading" className="report-h2">
              {t.hub.participants}
            </h2>
            <ul className="plain-list people-list">
              {participants.map((p, i) => (
                <li key={p}>
                  <span className="dot" style={{ background: pastelFor(i) }} aria-hidden="true" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="stack" style={{ gap: 10 }} aria-labelledby="chat-danger-heading">
          <h2 id="chat-danger-heading" className="small muted" style={{ fontWeight: 700 }}>
            {t.hub.thisChat}
          </h2>
          <ConfirmButton
            label={t.hub.deleteTheChat}
            question={t.hub.deleteChatQuestion}
            confirmLabel={t.hub.confirmDelete}
            busy={busy}
            onConfirm={removeAll}
          />
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
        </section>
      </main>
    </>
  )
}

/** Creation dates are real times, so they read in the viewer's own zone. */
function localDay(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
}

function titleFor(row: Row, entry: HistoryEntry, deletedLabel = 'Deleted report'): string {
  if (row.state === 'ok' && row.title) return row.title
  if (row.state === 'gone') return deletedLabel
  return `${entry.name}: report`
}

function statusText(row: Row): string {
  if (row.state === 'loading') return 'Loading'
  if (row.state === 'gone') return 'Deleted'
  if (row.state === 'error') return 'Unavailable'
  return STATUS_LABEL[row.status]
}
