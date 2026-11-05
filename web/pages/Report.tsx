import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { PersonaId } from '../../src/shared/types'
import { ReportView } from '../components/ReportView'
import { ReadingScreen } from '../components/ReadingScreen'
import { ThinkingScreen } from '../components/ThinkingScreen'
import { STORY_COUNT, StoryCard } from '../components/StoryCards'
import { DeepDiveButton, DeleteBox, FollowUpBox, ShareBox, reportPath, startReport, type ReaderSettings } from '../components/PrivateActions'
import { getReport, type ReportView as ReportRecord } from '../lib/api'
import { settingsForChat } from '../lib/history'
import { apiErrorMessage } from '../lib/messages'
import { PERSONA_NAMES } from '../lib/personas'
import { sessionFor, type ChatSession } from '../lib/session'
import { useReportJob, type ReportJob } from '../lib/useReportJob'
import { useI18n } from '../lib/i18n'
import { LanguageToggle } from '../components/LanguageToggle'

/**
 * The report route. Keyed by chat and report, so a retry (a new report id) starts a fresh flow.
 * With the in-memory session for this chat: reading, then the 7-card story, then thinking, then the
 * report. Without it (reload, another device): thinking, then the report.
 */
export function Report() {
  const { chatId = '', reportId = '' } = useParams()
  return <ReportFlow key={`${chatId}/${reportId}`} chatId={chatId} reportId={reportId} />
}

function ReportFlow({ chatId, reportId }: { chatId: string; reportId: string }) {
  const { t, lang } = useI18n()
  const [session] = useState<ChatSession | null>(() => sessionFor(chatId))
  const [history] = useState(() => settingsForChat(chatId))
  const [searchParams, setSearchParams] = useSearchParams()
  const job = useReportJob(reportId)
  const { view, viewError, reloadView } = useReportView(reportId, job.status)

  const readingDone = job.status !== 'running' || (job.total > 0 && job.phase !== 'summarizing')
  const show = searchParams.get('show')
  const step = clamp(Number(searchParams.get('step')) || 1, 1, STORY_COUNT)

  const persona: PersonaId = view?.persona ?? session?.persona ?? history?.persona ?? 'brandon'
  const language = view?.language ?? session?.language ?? history?.language ?? 'English'
  const me = session?.me ?? history?.me
  const settings: ReaderSettings | null =
    me !== undefined
      ? { chatId, name: session?.groupName ?? history?.name ?? 'Chat', persona, language, me }
      : null

  const goStep = (n: number) => setSearchParams({ show: 'steps', step: String(n) })
  const goWriting = () => setSearchParams({ show: 'writing' })

  const header = (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to={`/c/${encodeURIComponent(chatId)}`} className="icon-btn" aria-label={t.report.backToChat}>
          ←
        </Link>
        <span className="wordmark">Brandon Clone</span>
        <span className="topbar-spacer" />
        <LanguageToggle />
        <Link to="/setup" className="small" style={{ marginInlineStart: 12 }}>
          {t.report.newChat}
        </Link>
      </div>
    </header>
  )

  if (job.status === 'failed') {
    return (
      <>
        {header}
        <FailedScreen job={job} chatId={chatId} settings={settings} view={view} />
      </>
    )
  }

  if (session && show === null && !readingDone) {
    return (
      <ReadingScreen
        messages={session.chat.messages}
        participants={session.chat.participants}
        me={session.me}
        fraction={readingFraction(job)}
      />
    )
  }

  if (session && (show === 'steps' || (show === null && readingDone))) {
    return (
      <Story
        session={session}
        step={step}
        onStep={goStep}
        onFinish={goWriting}
      />
    )
  }

  if (job.status === 'done') {
    if (viewError) {
      return (
        <>
          {header}
          <main className="wrap report-main stack" style={{ gap: 16 }}>
            <p role="alert" className="field-error">
              {viewError}
            </p>
            <button type="button" className="btn" onClick={reloadView}>
              Try again
            </button>
          </main>
        </>
      )
    }
    if (!view?.content) {
      return (
        <>
          {header}
          <main className="wrap report-main">
            <p className="muted">Opening your report…</p>
          </main>
        </>
      )
    }
    return (
      <>
        {header}
        <main className="wrap report-main">
          <ReportView
            report={view.content}
            persona={view.persona}
            actions={<ShareBox reportId={reportId} />}
            memberAction={settings ? (name) => <DeepDiveButton settings={settings} name={name} /> : undefined}
          />
          <div className="stack" style={{ gap: 20, marginTop: 28 }}>
            {settings ? (
              <FollowUpBox settings={settings} />
            ) : (
              <p className="small muted">Start a new report from the chat page to ask follow-up questions.</p>
            )}
            {settings && <DeleteBox settings={settings} reportId={reportId} />}
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      {header}
      <ThinkingScreen
        persona={persona}
        progress={job.progress}
        total={job.total}
        retrying={job.error === 'rate_limited' || (job.error !== null && job.error !== 'not_found')}
      />
    </>
  )
}

function readingFraction(job: ReportJob): number {
  if (job.status !== 'running') return 1
  if (job.phase !== 'summarizing') return 1
  const chunks = job.total - 1
  return chunks > 0 ? Math.min(1, job.progress / chunks) : 0
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** Loads the stored report once it is done (and on failure, for the settings it was made with). */
function useReportView(reportId: string, status: ReportJob['status']) {
  const [view, setView] = useState<ReportRecord | null>(null)
  const [viewError, setViewError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (status !== 'done') return
    let cancelled = false
    getReport(reportId)
      .then((v) => {
        if (cancelled) return
        setView(v)
        setViewError(v.content ? null : 'The report is not ready to read yet. Try again in a moment.')
      })
      .catch((e: unknown) => {
        if (!cancelled) setViewError(apiErrorMessage(e))
      })
    return () => {
      cancelled = true
    }
  }, [reportId, status, attempt])

  return { view, viewError, reloadView: () => setAttempt((n) => n + 1) }
}

function Story({
  session,
  step,
  onStep,
  onFinish,
}: {
  session: ChatSession
  step: number
  onStep: (n: number) => void
  onFinish: () => void
}) {
  const { t, lang } = useI18n()
  const last = step === STORY_COUNT
  return (
    <main className="story-page">
      <div className="story-top">
        <button
          type="button"
          className="icon-btn"
          onClick={() => onStep(step - 1)}
          disabled={step === 1}
          aria-label={t.story.previousCard}
        >
          ←
        </button>
        <div className="progress story-progress" role="progressbar" aria-label="Story progress" aria-valuemin={1} aria-valuemax={STORY_COUNT} aria-valuenow={step}>
          <span style={{ width: `${(step / STORY_COUNT) * 100}%` }} />
        </div>
        <span className="small muted" aria-live="polite">
          {lang === 'he' ? `${step} מתוך ${STORY_COUNT}` : `${step} of ${STORY_COUNT}`}
        </span>
      </div>
      <div key={step} className="step-enter story-body">
        <StoryCard index={step} stats={session.stats} extras={session.extras} />
      </div>
      <div className="story-footer">
        <button type="button" className="btn btn-dark btn-block" onClick={() => (last ? onFinish() : onStep(step + 1))}>
          {last ? (lang === 'he' ? t.story.seeTheReport : 'See the report') : (lang === 'he' ? t.story.continue : 'Continue')}
        </button>
      </div>
    </main>
  )
}

function FailedScreen({
  job,
  chatId,
  settings,
  view,
}: {
  job: ReportJob
  chatId: string
  settings: ReaderSettings | null
  view: ReportRecord | null
}) {
  const navigate = useNavigate()
  const { t, lang } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const message =
    job.error === 'network'
      ? "We couldn't reach the server, so this report stopped. Check your connection and try again."
      : job.error === 'not_found'
        ? "We couldn't find this report any more. It may have been deleted."
        : 'We could not finish this report. Try again.'

  const retry = async () => {
    if (!settings) return
    setBusy(true)
    setError(null)
    try {
      // Same settings as the first report. A group report is retried as a group report, and a member
      // report keeps its subject.
      const reportId = await startReport(settings, {
        persona: settings.persona,
        language: settings.language,
        me: settings.me,
        ...(view?.kind === 'member' && view.subject
          ? { kind: 'member' as const, subject: view.subject }
          : { kind: 'group' as const }),
      })
      navigate(reportPath(settings.chatId, reportId), { replace: true })
    } catch (e) {
      setError(apiErrorMessage(e))
      setBusy(false)
    }
  }

  return (
    <main className="wrap report-main stack" style={{ gap: 16, textAlign: 'center', paddingTop: 48 }}>
      <h1 className="report-h2">{t.report.reportStopped}</h1>
      <p role="alert" className="muted">
        {message}
      </p>
      {settings ? (
        <button type="button" className="btn btn-block" onClick={retry} disabled={busy}>
          {busy ? (lang === 'he' ? t.report.startingAgain : 'Starting again…') : (lang === 'he' ? t.report.tryAgain : 'Try again')}
        </button>
      ) : (
        <Link to={`/c/${encodeURIComponent(chatId)}`} className="btn btn-ghost">
          {lang === 'he' ? t.report.backToChat : 'Back to the chat'}
        </Link>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      <p className="small muted">{PERSONA_NAMES[view?.persona ?? 'brandon']} will start from a fresh report.</p>
    </main>
  )
}
