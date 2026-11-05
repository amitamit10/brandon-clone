import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Mascot } from '../components/Mascot'
import { deleteChat, deleteReport } from '../lib/api'
import { readHistory, removeReport, type HistoryEntry } from '../lib/history'
import { apiErrorMessage } from '../lib/messages'
import { PERSONA_NAMES } from '../lib/personas'
import { useI18n } from '../lib/i18n'
import { LanguageToggle } from '../components/LanguageToggle'

export function History() {
  const { t, lang } = useI18n()
  const [entries, setEntries] = useState<HistoryEntry[]>(() => readHistory())
  const [deleting, setDeleting] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  /** The last report of a chat takes the chat with it, so the uploaded text is not left on the server. */
  const isLastForChat = (entry: HistoryEntry) => entries.filter((e) => e.chatId === entry.chatId).length === 1

  /**
   * Deletes on the server first, then locally. A 404 means it is already gone on the server, so the
   * local entry is removed too. A network or server error keeps the entry and shows a message.
   */
  const remove = async (entry: HistoryEntry) => {
    const wholeChat = isLastForChat(entry)
    setDeleting(entry.reportId)
    setErrors((prev) => omit(prev, entry.reportId))
    try {
      if (wholeChat) await deleteChat(entry.chatId)
      else await deleteReport(entry.reportId)
    } catch (e) {
      if (!(typeof e === 'object' && e !== null && (e as { status?: unknown }).status === 404)) {
        setErrors((prev) => ({ ...prev, [entry.reportId]: apiErrorMessage(e) }))
        setDeleting(null)
        return
      }
    }
    removeReport(entry.reportId)
    setEntries(readHistory())
    setDeleting(null)
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="icon-btn" aria-label={t.nav.home}>
            ←
          </Link>
          <span className="wordmark">{t.history.title}</span>
          <span className="topbar-spacer" />
          <LanguageToggle />
        </div>
      </header>

      <main className="wrap stack" style={{ gap: 16, paddingTop: 16, paddingBottom: 48 }}>
        <h1 className="report-h1">{t.history.title}</h1>
        {entries.length === 0 ? (
          <section className="card stack" style={{ gap: 12, textAlign: 'center' }}>
            <p>{t.history.empty}</p>
            <Link to="/setup" className="btn btn-block">
              {t.history.uploadAChat}
            </Link>
          </section>
        ) : (
          <ul className="stack" style={{ gap: 12, listStyle: 'none', padding: 0, margin: 0 }}>
            {entries.map((entry) => {
              const persona = entry.persona ?? 'brandon'
              const personaName = lang === 'he'
                ? (persona === 'brandon' ? t.personas.brandonName : persona === 'clara' ? t.personas.claraName : t.personas.diegoName)
                : PERSONA_NAMES[persona]
              const kindText = entry.kind === 'followup'
                ? ` · ${t.history.followUp}`
                : entry.kind === 'member'
                  ? ` · ${t.history.deepDive}`
                  : ''
              return (
                <li key={entry.reportId} className="card history-item">
                  <Mascot persona={persona} size={44} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <strong className="history-name">{entry.name}</strong>
                    <p className="small muted">
                      {personaName} · {formatWhen(entry.createdAt)}
                      {kindText}
                    </p>
                    <div className="row-actions" style={{ marginTop: 8 }}>
                      <Link className="btn btn-ghost" to={`/c/${encodeURIComponent(entry.chatId)}/reports/${encodeURIComponent(entry.reportId)}`}>
                        {t.history.open}
                      </Link>
                      <button
                        type="button"
                        className="btn btn-ghost btn-danger"
                        onClick={() => remove(entry)}
                        disabled={deleting === entry.reportId}
                        aria-label={`${isLastForChat(entry) ? 'Delete chat' : 'Delete report'} on ${entry.name}`}
                      >
                        {deleting === entry.reportId ? (lang === 'he' ? t.history.deleting : 'Deleting…') : isLastForChat(entry) ? (lang === 'he' ? t.history.deleteChat : 'Delete chat') : (lang === 'he' ? t.history.delete : 'Delete')}
                      </button>
                    </div>
                    {errors[entry.reportId] && (
                      <p role="alert" className="field-error">
                        {errors[entry.reportId]}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </main>
    </>
  )
}

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record
  return rest
}

function formatWhen(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
}
