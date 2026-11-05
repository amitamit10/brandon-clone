import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ReportView } from '../components/ReportView'
import { ApiError, getShared, type SharedReport } from '../lib/api'
import { apiErrorMessage } from '../lib/messages'
import { useI18n } from '../lib/i18n'
import { LanguageToggle } from '../components/LanguageToggle'
import { formatReportForWhatsApp } from '../components/PrivateActions'
import type { GroupReport } from '../../src/shared/types'

function SharedActions({ report, shareId }: { report: GroupReport; shareId: string }) {
  const { t, lang } = useI18n()
  const [copiedLink, setCopiedLink] = useState(0)
  const [copiedText, setCopiedText] = useState(0)
  const link = `${window.location.origin}/s/${shareId}`

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopiedLink((n) => n + 1)
    } catch {
      // ignore clipboard error
    }
  }

  const copyFullText = async () => {
    try {
      const fullText = formatReportForWhatsApp(report, link, lang)
      await navigator.clipboard.writeText(fullText)
      setCopiedText((n) => n + 1)
    } catch {
      // ignore clipboard error
    }
  }

  const whatsappShareUrl = () => {
    const fullText = formatReportForWhatsApp(report, link, lang)
    return `https://api.whatsapp.com/send?text=${encodeURIComponent(fullText)}`
  }

  return (
    <div className="card stack" style={{ gap: 10, padding: '14px 16px', background: 'rgba(121, 40, 202, 0.05)', borderRadius: '16px' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <a
          href={whatsappShareUrl()}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-primary"
          style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, flex: 1, minWidth: '180px', justifyContent: 'center' }}
        >
          <span>💬 {t.report.shareWhatsApp}</span>
        </a>
        <button
          key={`text-${copiedText}`}
          type="button"
          className={`btn${copiedText > 0 ? ' hop' : ''}`}
          onClick={copyFullText}
        >
          <span aria-hidden="true">📋 </span>
          {copiedText > 0 ? t.report.fullTextCopied : t.report.copyFullText}
        </button>
        <button
          key={`link-${copiedLink}`}
          type="button"
          className={`btn btn-ghost${copiedLink > 0 ? ' hop' : ''}`}
          onClick={copyLink}
        >
          <span aria-hidden="true">🔗 </span>
          {copiedLink > 0 ? t.report.copied : t.report.copyLink}
        </button>
      </div>
    </div>
  )
}

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
          <ReportView
            report={state.data.content}
            persona={state.data.persona}
            actions={<SharedActions report={state.data.content} shareId={shareId} />}
          />
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
