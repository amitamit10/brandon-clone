import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { SafeText } from '../components/AdminSafeText'
import { AdminError, adminApi, type ChatDetail, type ChatSummary, type Overview, type ReportContent, type ReportView, type Uploader } from '../lib/adminApi'
import './admin.css'

type Screen = 'checking' | 'login' | 'disabled' | 'ready'
const REFRESH_MS = 60_000
const DAYS = 30

/** Keeps search engines out of the owner's page. Only this page sets it. */
function useNoIndex() {
  useEffect(() => {
    let meta = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]')
    const created = meta === null
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'robots'
      document.head.appendChild(meta)
    }
    meta.content = 'noindex'
    return () => {
      if (created) meta?.remove()
    }
  }, [])
}

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export function Admin() {
  useNoIndex()
  const [screen, setScreen] = useState<Screen>('checking')
  const [overview, setOverview] = useState<Overview | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [tab, setTab] = useState<'dashboard' | 'people'>('dashboard')
  const [tokenInput, setTokenInput] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  /** Any request that fails: 401 means log in again, 404 means the admin is off. */
  const onError = useCallback((e: unknown) => {
    if (e instanceof AdminError && e.status === 401) {
      setOverview(null)
      setScreen('login')
      setMessage('Log in to see the dashboard.')
      return
    }
    if (e instanceof AdminError && e.status === 404) {
      setScreen('disabled')
      return
    }
    setMessage('Could not load. Try again.')
  }, [])

  const refresh = useCallback(async () => {
    try {
      const data = await adminApi.overview(DAYS)
      setOverview(data)
      setScreen('ready')
      setMessage(null)
      setRefreshKey((k) => k + 1)
    } catch (e) {
      onError(e)
    }
  }, [onError])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Refresh every minute, but only while the tab is visible.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, REFRESH_MS)
    return () => clearInterval(id)
  }, [refresh])

  const submitLogin = async (e: FormEvent) => {
    e.preventDefault()
    const token = tokenInput
    // The token is cleared before the request and never stored anywhere.
    setTokenInput('')
    setMessage(null)
    try {
      await adminApi.login(token)
    } catch (err) {
      if (err instanceof AdminError && err.status === 401) setMessage('That token is not right.')
      else if (err instanceof AdminError && err.status === 429) setMessage('Too many tries. Wait an hour and try again.')
      else if (err instanceof AdminError && err.status === 404) setScreen('disabled')
      else setMessage('Could not log in. Try again.')
      return
    }
    await refresh()
  }

  const logout = async () => {
    try {
      await adminApi.logout()
    } catch {
      // Logging out locally is enough when the request fails.
    }
    setOverview(null)
    setScreen('login')
    setMessage(null)
  }

  if (screen === 'checking') {
    return (
      <main className="admin">
        <p className="muted">Loading…</p>
      </main>
    )
  }

  if (screen === 'disabled') {
    return (
      <main className="admin">
        <h1>Admin</h1>
        <p role="alert" className="admin-alert">
          Admin is not enabled
        </p>
      </main>
    )
  }

  if (screen === 'login') {
    return (
      <main className="admin admin-login">
        <h1>Admin</h1>
        <form className="stack" onSubmit={submitLogin} autoComplete="off">
          <label className="stack" style={{ gap: 6 }}>
            <span style={{ fontWeight: 700 }}>Admin token</span>
            <input
              className="field"
              type="password"
              aria-label="Admin token"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </label>
          <button type="submit" className="btn btn-dark" disabled={tokenInput.length === 0}>
            Log in
          </button>
        </form>
        {message && (
          <p role="alert" className="admin-alert">
            {message}
          </p>
        )}
      </main>
    )
  }

  return (
    <main className="admin">
      <header className="admin-head">
        <h1>Admin</h1>
        <div className="admin-actions">
          <button type="button" className="btn btn-ghost" onClick={() => void refresh()}>
            Refresh
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </header>
      <nav className="admin-tabs" aria-label="Admin sections">
        <button type="button" aria-pressed={tab === 'dashboard'} className="pill" onClick={() => setTab('dashboard')}>
          Dashboard
        </button>
        <button type="button" aria-pressed={tab === 'people'} className="pill" onClick={() => setTab('people')}>
          People
        </button>
      </nav>
      {message && (
        <p role="alert" className="admin-alert">
          {message}
        </p>
      )}
      {tab === 'dashboard' && overview && (
        <>
          <OverviewPanel overview={overview} />
          <ChatsPanel refreshKey={refreshKey} onError={onError} onChanged={() => void refresh()} />
        </>
      )}
      {tab === 'people' && <PeoplePanel refreshKey={refreshKey} onError={onError} />}
    </main>
  )
}

function Tile({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={`tile admin-tile ${tone}`}>
      <span className="admin-tile-label">{label}</span>
      <strong className="admin-tile-value">{value}</strong>
    </div>
  )
}

function OverviewPanel({ overview }: { overview: Overview }) {
  const today = overview.daily[overview.daily.length - 1]
  const byStatus = overview.totals.reportsByStatus
  return (
    <section aria-labelledby="overview-title" className="admin-section">
      <h2 id="overview-title">Overview</h2>
      <div className="admin-tiles" role="region" aria-label="Totals">
        <Tile label="Active chats" value={String(overview.totals.chatsActive)} tone="tile-lilac" />
        <Tile label="Reports" value={String(overview.totals.reportsAll)} tone="tile-pink" />
        <Tile label="Done" value={String(byStatus.done ?? 0)} tone="tile-mint" />
        <Tile label="Failed" value={String(byStatus.failed ?? 0)} tone="tile-peach" />
        <Tile label="Shared links" value={String(overview.totals.sharedLinks)} tone="tile-butter" />
        <Tile label="Visitors today" value={String(today?.visitors ?? 0)} tone="tile-lilac" />
        <Tile label="LLM calls today" value={String(today?.llmCalls ?? 0)} tone="tile-mint" />
        <Tile label="Avg report time" value={overview.avgReportSeconds === null ? '—' : `${overview.avgReportSeconds} s`} tone="tile-pink" />
        <Tile label="Content views" value={String(overview.totals.contentViews)} tone="tile-peach" />
      </div>
      <div className="admin-charts">
        <Bars title="Uploads" values={overview.daily.map((d) => d.uploads)} />
        <Bars title="Reports created" values={overview.daily.map((d) => d.reportsCreated)} />
        <Bars title="LLM calls (red: failed)" values={overview.daily.map((d) => d.llmCalls)} overlay={overview.daily.map((d) => d.llmFails)} />
        <Bars title="Visitors" values={overview.daily.map((d) => d.visitors)} />
        <Bars title="Rate limited" values={overview.daily.map((d) => d.rateLimited)} />
      </div>
      <h3 className="admin-sub">LLM by model (last {DAYS} days)</h3>
      {overview.llmByModel.length === 0 ? (
        <p className="muted small">No calls yet.</p>
      ) : (
        <div className="admin-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col">Calls</th>
                <th scope="col">Fails</th>
                <th scope="col">429s</th>
              </tr>
            </thead>
            <tbody>
              {overview.llmByModel.map((m) => (
                <tr key={m.key}>
                  <td>{m.key}</td>
                  <td>{m.calls}</td>
                  <td>{m.fails}</td>
                  <td>{m.rate429}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/** A small bar chart. The optional overlay draws a second series on top, in the failure colour. */
function Bars({ title, values, overlay }: { title: string; values: number[]; overlay?: number[] }) {
  const max = Math.max(1, ...values, ...(overlay ?? []))
  const W = 300
  const H = 72
  const step = W / Math.max(1, values.length)
  return (
    <figure className="admin-chart">
      <figcaption>{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}, last ${values.length} days`} preserveAspectRatio="none">
        {values.map((v, i) => (
          <rect key={`v${i}`} x={i * step + 1} y={H - (v / max) * H} width={Math.max(1, step - 2)} height={(v / max) * H} rx={2} style={{ fill: 'var(--primary)' }} />
        ))}
        {overlay?.map((v, i) => (
          <rect key={`o${i}`} x={i * step + step / 4} y={H - (v / max) * H} width={Math.max(1, step / 2)} height={(v / max) * H} style={{ fill: 'var(--danger)' }} />
        ))}
      </svg>
    </figure>
  )
}

/** Two-step button: the first click arms it, the second runs the action. */
function TwoStep({ label, confirmLabel, onConfirm, disabled }: { label: string; confirmLabel: string; onConfirm: () => void; disabled?: boolean }) {
  const [armed, setArmed] = useState(false)
  if (!armed) {
    return (
      <button type="button" className="btn btn-ghost admin-danger" disabled={disabled} onClick={() => setArmed(true)}>
        {label}
      </button>
    )
  }
  return (
    <span className="admin-confirm">
      <button type="button" className="btn admin-danger-solid" disabled={disabled} onClick={() => { setArmed(false); onConfirm() }}>
        {confirmLabel}
      </button>
      <button type="button" className="btn btn-ghost" onClick={() => setArmed(false)}>
        Cancel
      </button>
    </span>
  )
}

function ChatsPanel({ refreshKey, onError, onChanged }: { refreshKey: number; onError: (e: unknown) => void; onChanged: () => void }) {
  const [q, setQ] = useState('')
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [total, setTotal] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    // Typing waits a moment, so each keystroke does not send a request.
    const timer = setTimeout(
      () => {
        adminApi
          .listChats({ q: q.trim(), limit: 50 })
          .then((r) => {
            if (live) {
              setChats(r.chats)
              setTotal(r.total)
            }
          })
          .catch((e: unknown) => live && onError(e))
      },
      q ? 250 : 0,
    )
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [q, refreshKey, onError])

  return (
    <section aria-labelledby="chats-title" className="admin-section">
      <div className="admin-head">
        <h2 id="chats-title">Chats</h2>
        <span className="small muted">{total} total</span>
      </div>
      <input
        className="field"
        type="search"
        aria-label="Search chats"
        placeholder="Search group, uploader or member name"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="admin-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">Group</th>
              <th scope="col">Uploader</th>
              <th scope="col">Members</th>
              <th scope="col">Messages</th>
              <th scope="col">Reports</th>
              <th scope="col">Created</th>
              <th scope="col">Expires</th>
              <th scope="col">Shared</th>
            </tr>
          </thead>
          <tbody>
            {chats.map((c) => (
              <ChatRow key={c.id} chat={c} open={openId === c.id} onToggle={() => setOpenId(openId === c.id ? null : c.id)} onError={onError} onChanged={() => { setOpenId(null); onChanged() }} />
            ))}
          </tbody>
        </table>
      </div>
      {chats.length === 0 && <p className="muted small">No chats match.</p>}
    </section>
  )
}

function ChatRow({ chat, open, onToggle, onError, onChanged }: { chat: ChatSummary; open: boolean; onToggle: () => void; onError: (e: unknown) => void; onChanged: () => void }) {
  return (
    <>
      <tr>
        <td>
          <button type="button" className="admin-link" aria-expanded={open} onClick={onToggle}>
            {chat.groupName}
          </button>
          {chat.expired && <span className="small muted"> (expired)</span>}
        </td>
        <td>{chat.uploaderName}</td>
        <td>{chat.participantNames.join(', ')}</td>
        <td>{chat.messages}</td>
        <td>
          {chat.reports} <span className="small muted">({chat.reportsDone} done)</span>
        </td>
        <td>{fmtDate(chat.createdAt)}</td>
        <td>{fmtDate(chat.expiresAt)}</td>
        <td>{chat.hasShared ? 'Yes' : 'No'}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8}>
            <ChatDetailView chatId={chat.id} onError={onError} onChanged={onChanged} />
          </td>
        </tr>
      )}
    </>
  )
}

function ChatDetailView({ chatId, onError, onChanged }: { chatId: string; onError: (e: unknown) => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<ChatDetail | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [showMessages, setShowMessages] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    adminApi
      .getChat(chatId)
      .then((d) => live && setDetail(d))
      .catch((e: unknown) => live && onError(e))
    return () => {
      live = false
    }
  }, [chatId, reloadKey, onError])

  const run = async (action: () => Promise<unknown>, done: () => void) => {
    setNote(null)
    try {
      await action()
      done()
    } catch (e) {
      if (e instanceof AdminError && e.status === 401) onError(e)
      else setNote('That did not work. Try again.')
    }
  }

  if (!detail) return <p className="muted small">Loading…</p>

  return (
    <div className="admin-detail stack">
      <p className="small">
        <strong>{detail.groupName}</strong> · uploaded by {detail.uploaderName} · {detail.messages} messages · {detail.participantNames.join(', ')}
      </p>
      {note && (
        <p role="alert" className="admin-alert">
          {note}
        </p>
      )}
      <div className="admin-actions">
        <button type="button" className="btn btn-ghost" onClick={() => setShowMessages((v) => !v)}>
          {showMessages ? 'Hide messages' : 'Read messages'}
        </button>
        <TwoStep
          label="Delete chat"
          confirmLabel="Confirm delete chat"
          onConfirm={() => void run(() => adminApi.deleteChat(chatId), onChanged)}
        />
      </div>
      {showMessages && <MessageViewer chatId={chatId} chunks={detail.chunks} onError={onError} />}
      {detail.reports.length === 0 && <p className="muted small">No reports for this chat.</p>}
      {detail.reports.map((r) => (
        <ReportCard key={r.id} chatId={chatId} report={r} onRun={(action) => void run(action, () => setReloadKey((k) => k + 1))} />
      ))}
    </div>
  )
}

function ReportCard({ chatId, report, onRun }: { chatId: string; report: ReportView; onRun: (action: () => Promise<unknown>) => void }) {
  const fullReportUrl = `/c/${encodeURIComponent(chatId)}/reports/${encodeURIComponent(report.id)}`
  const sharedUrl = report.shareId ? `/s/${encodeURIComponent(report.shareId)}` : null

  return (
    <article className="admin-report stack">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <p className="small muted" style={{ margin: 0 }}>
          <strong>{report.kind.toUpperCase()}</strong> · {report.persona} · {report.language} ·{' '}
          <span style={{ fontWeight: 600 }}>{report.status}</span> ({report.progress}/{report.total})
          {report.error ? ` · error: ${report.error}` : ''}
          {report.question ? ' · follow-up' : ''}
        </p>
        <span className="small muted">{fmtDate(report.createdAt)}</span>
      </div>
      {report.question && <p className="small"><strong>Question:</strong> {report.question}</p>}
      <div className="admin-actions" style={{ marginTop: 8, marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <a
          href={fullReportUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-primary"
          style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}
        >
          📄 View Full Report Page ↗
        </a>
        {sharedUrl && (
          <a
            href={sharedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            🔗 Open Shared Link ↗
          </a>
        )}
        {report.shared && (
          <TwoStep label="Stop sharing" confirmLabel="Confirm stop sharing" onConfirm={() => onRun(() => adminApi.unshareReport(report.id))} />
        )}
        <TwoStep label="Delete report" confirmLabel="Confirm delete report" onConfirm={() => onRun(() => adminApi.deleteReport(report.id))} />
      </div>
      {report.content ? (
        <details className="admin-report-details" style={{ marginTop: 4 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', color: 'var(--primary)' }}>
            👁️ Preview Raw Text Content
          </summary>
          <div style={{ marginTop: 10 }}>
            <ReportBody content={report.content} />
          </div>
        </details>
      ) : (
        <p className="muted small">No report text yet.</p>
      )}
    </article>
  )
}

function ReportBody({ content }: { content: ReportContent }) {
  return (
    <div className="admin-report-body">
      {content.title && <h4>{content.title}</h4>}
      {content.intro && <SafeText text={content.intro} />}
      {(content.sections ?? []).map((s, i) => (
        <section key={i}>
          {s.heading && <h5>{s.heading}</h5>}
          {s.body && <SafeText text={s.body} />}
        </section>
      ))}
      {(content.members ?? []).length > 0 && (
        <ul className="admin-members">
          {(content.members ?? []).map((m, i) => (
            <li key={i}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong>{m.name}</strong>
                {m.nickname && <span className="muted small">“{m.nickname}”</span>}
                {m.aura?.score && (
                  <span
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: m.aura.score.startsWith('-') ? 'rgba(239, 68, 68, 0.12)' : 'rgba(121, 40, 202, 0.12)',
                      color: m.aura.score.startsWith('-') ? '#dc2626' : '#7928ca',
                      border: '1px solid currentColor',
                    }}
                  >
                    ⚡ {m.aura.score} {m.aura.status ? `(${m.aura.status})` : ''}
                  </span>
                )}
              </div>
              {m.opinion ? <p style={{ margin: '4px 0' }}>{m.opinion}</p> : null}
              {m.quote ? <blockquote>{m.quote}</blockquote> : null}
            </li>
          ))}
        </ul>
      )}
      {content.advice && <SafeText text={content.advice} />}
    </div>
  )
}

function MessageViewer({ chatId, chunks, onError }: { chatId: string; chunks: number; onError: (e: unknown) => void }) {
  const [index, setIndex] = useState(0)
  const [text, setText] = useState<string | null>(null)
  const [count, setCount] = useState(chunks)

  useEffect(() => {
    let live = true
    setText(null)
    adminApi
      .getMessages(chatId, index)
      .then((r) => {
        if (live) {
          setText(r.text)
          setCount(r.chunks)
        }
      })
      .catch((e: unknown) => live && onError(e))
    return () => {
      live = false
    }
  }, [chatId, index, onError])

  return (
    <div className="admin-messages stack">
      <div className="admin-actions">
        <button type="button" className="btn btn-ghost" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
          Previous
        </button>
        <span className="small muted">
          Part {index + 1} of {count}
        </span>
        <button type="button" className="btn btn-ghost" disabled={index >= count - 1} onClick={() => setIndex((i) => i + 1)}>
          Next
        </button>
      </div>
      <pre className="admin-pre">{text ?? 'Loading…'}</pre>
    </div>
  )
}

function PeoplePanel({ refreshKey, onError }: { refreshKey: number; onError: (e: unknown) => void }) {
  const [people, setPeople] = useState<Uploader[] | null>(null)

  useEffect(() => {
    let live = true
    adminApi
      .listUploaders()
      .then((r) => live && setPeople(r.uploaders))
      .catch((e: unknown) => live && onError(e))
    return () => {
      live = false
    }
  }, [refreshKey, onError])

  return (
    <section aria-labelledby="people-title" className="admin-section">
      <h2 id="people-title">People</h2>
      <p className="small muted">Names as typed by uploaders, grouped without case. Not verified.</p>
      {people === null ? (
        <p className="muted small">Loading…</p>
      ) : (
        <div className="admin-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Chats</th>
                <th scope="col">Reports</th>
                <th scope="col">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.uploaderName}>
                  <td>{p.uploaderName}</td>
                  <td>{p.chats}</td>
                  <td>{p.reports}</td>
                  <td>{fmtDate(p.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
