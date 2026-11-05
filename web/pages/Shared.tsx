import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ReportView } from '../components/ReportView'
import { ApiError, getShared, type SharedReport } from '../lib/api'
import { apiErrorMessage } from '../lib/messages'
import { useI18n } from '../lib/i18n'
import { LanguageToggle } from '../components/LanguageToggle'

/**
 * The read-only page behind a share link. It never touches the in-memory session or the history:
 * a shared link must show the same thing to everyone, on any device.
 */
export function Shared() {
  const { t } = useI18n()
  const { shareId = '' } = useParams()
  const [state, setState] = useState<{ status: 'loading' } | { status: 'ok'; data: SharedReport } | { status: 'gone' } | { status: 'error'; message: string }>({
    status: 'loading',
  })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    getShared(shareId)
      .then((data) => {
        if (!cancelled) setState({ status: 'ok', data })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        if (e instanceof ApiError && e.status === 404) setState({ status: 'gone' })
        else setState({ status: 'error', message: apiErrorMessage(e) })
      })
    return () => {
      cancelled = true
    }
  }, [shareId])

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="wordmark">Brandon Clone</span>
          <span className="topbar-spacer" />
          <LanguageToggle />
        </div>
      </header>

      <main className="wrap report-main">
        {state.status === 'loading' && <p className="muted">{t.shared.opening}</p>}

        {state.status === 'gone' && (
          <section className="stack" style={{ gap: 12, textAlign: 'center', paddingTop: 48 }}>
            <h1 className="report-h2">{t.shared.linkInactive}</h1>
            <p className="muted">{t.shared.linkInactiveSub}</p>
          </section>
        )}

        {state.status === 'error' && (
          <section className="stack" style={{ gap: 12, textAlign: 'center', paddingTop: 48 }}>
            <h1 className="report-h2">{t.shared.couldNotOpen}</h1>
            <p role="alert" className="muted">
              {state.message}
            </p>
          </section>
        )}

        {state.status === 'ok' && (
          <ReportView report={state.data.content} persona={state.data.persona} />
        )}

        <footer className="shared-footer">
          <Link to="/" className="btn btn-block">
            {t.shared.makeYourOwn}
          </Link>
        </footer>
      </main>
    </>
  )
}
