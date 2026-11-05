import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Mascot } from '../components/Mascot'
import { RingCluster } from '../components/RingCluster'
import { ChatMarquee } from '../components/ChatMarquee'
import { PrivacyNote } from '../components/PrivacyNote'
import { DEMO_CHATS, type DemoChat } from '../lib/demo'
import { PERSONA_NAMES } from '../lib/personas'

const HOW_IT_WORKS = [
  { title: 'Export', body: 'In WhatsApp, export the group chat without media. It takes a minute.' },
  { title: 'Upload', body: 'Drop the .zip or .txt here. It is read in your browser first.' },
  { title: 'Read', body: 'Brandon writes the report. Every quote is checked against the chat.' },
]

export function Landing() {
  const [picked, setPicked] = useState<DemoChat | null>(null)

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Mascot persona="brandon" size={32} />
          <span className="wordmark">Brandon Clone</span>
          <span className="topbar-spacer" />
          <Link className="small" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }} to="/history">
            My chats
          </Link>
          <Link className="btn" style={{ minHeight: 44, padding: '0 16px' }} to="/setup">
            Try it now →
          </Link>
        </div>
      </header>

      <main className="wrap">
        <section className="hero" aria-labelledby="hero-heading">
          <RingCluster />
          <h1 id="hero-heading">Upload a group chat. Brandon tells you what's really going on.</h1>
          <p className="hero-sub">
            Export a WhatsApp group, drop it here, and get a blunt, specific report on everyone in it.
          </p>
          <Link className="btn btn-block" to="/setup">
            Upload your chat →
          </Link>
        </section>

        <ChatMarquee selectedId={picked?.id ?? null} onPick={setPicked} />

        <section className="demo-area" aria-labelledby="demo-heading">
          <h2 id="demo-heading" className="step-title" style={{ fontSize: '1.3rem' }}>
            Tap a chat to see a demo
          </h2>
          <div className="card" style={{ marginTop: 12 }} aria-live="polite">
            {picked ? <DemoReport chat={picked} /> : <p className="muted">Pick a chat above. The example is made up.</p>}
          </div>
        </section>

        <section className="steps-strip" aria-labelledby="how-heading">
          <h2 id="how-heading" className="step-title" style={{ fontSize: '1.3rem' }}>
            How it works
          </h2>
          {HOW_IT_WORKS.map((step, i) => (
            <div key={step.title} className="card step-chip">
              <span className="step-num" aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <strong>{step.title}</strong>
                <p className="small muted">{step.body}</p>
              </div>
            </div>
          ))}
        </section>

        <footer className="site-footer">
          <PrivacyNote />
          <p className="small" style={{ marginTop: 8 }}>
            {DEMO_CHATS.length} example chats, all made up.
          </p>
        </footer>
      </main>
    </>
  )
}

function DemoReport({ chat }: { chat: DemoChat }) {
  return (
    <div className="demo-card">
      <div className="halo">
        <Mascot persona={chat.persona} size={72} />
      </div>
      <p className="small muted">{PERSONA_NAMES[chat.persona]} on {chat.label}</p>
      <h3 style={{ fontSize: '1.2rem' }}>{chat.title}</h3>
      <ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
        {chat.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="small muted">Made-up example, not from a real chat.</p>
    </div>
  )
}
