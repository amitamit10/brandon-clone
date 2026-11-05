import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Mascot } from '../components/Mascot'
import { deleteReport } from '../lib/api'
import { readHistory, removeReport, type HistoryEntry } from '../lib/history'
import { apiErrorMessage } from '../lib/messages'
import { PERSONA_NAMES } from '../lib/personas'

export function History() {
  const [entries, setEntries] = useState<HistoryEntry[]>(() => readHistory())
  const [deleting, setDeleting] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  /**
   * Deletes on the server first, then locally. A 404 means it is already gone on the server, so the
   * local entry is removed too. A network or server error keeps the entry and shows a message.
   */
  const remove = async (entry: HistoryEntry) => {
    setDeleting(entry.reportId)
    setErrors((prev) => omit(prev, entry.reportId))
    try {
      await deleteReport(entry.reportId)
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
          <Link to="/" className="icon-btn" aria-label="Home">
            ←
          </Link>
          <span className="wordmark">My chats</span>
          <span className="topbar-spacer" />
        </div>
      </header>

      <main className="wrap stack" style={{ gap: 16, paddingTop: 16, paddingBottom: 48 }}>
        <h1 className="report-h1">My chats</h1>
        {entries.length === 0 ? (
          <section className="card stack" style={{ gap: 12, textAlign: 'center' }}>
            <p>No chats yet on this device.</p>
            <Link to="/setup" className="btn btn-block">
              Upload a chat
            </Link>
          </section>
        ) : (
          <ul className="stack" style={{ gap: 12, listStyle: 'none', padding: 0, margin: 0 }}>
            {entries.map((entry) => (
              <li key={entry.reportId} className="card history-item">
                <Mascot persona={entry.persona ?? 'brandon'} size={44} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <strong className="history-name">{entry.name}</strong>
                  <p className="small muted">
                    {PERSONA_NAMES[entry.persona ?? 'brandon']} · {formatWhen(entry.createdAt)}
                    {entry.kind === 'followup' ? ' · follow-up' : entry.kind === 'member' ? ' · deep dive' : ''}
                  </p>
                  <div className="row-actions" style={{ marginTop: 8 }}>
                    <Link className="btn btn-ghost" to={`/c/${encodeURIComponent(entry.chatId)}/reports/${encodeURIComponent(entry.reportId)}`}>
                      Open
                    </Link>
                    <button
                      type="button"
                      className="btn btn-ghost btn-danger"
                      onClick={() => remove(entry)}
                      disabled={deleting === entry.reportId}
                      aria-label={`Delete report on ${entry.name}`}
                    >
                      {deleting === entry.reportId ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                  {errors[entry.reportId] && (
                    <p role="alert" className="field-error">
                      {errors[entry.reportId]}
                    </p>
                  )}
                </div>
              </li>
            ))}
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
