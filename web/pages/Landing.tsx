import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Mascot } from '../components/Mascot'
import { RingCluster } from '../components/RingCluster'
import { ChatMarquee } from '../components/ChatMarquee'
import { PrivacyNote } from '../components/PrivacyNote'
import { LanguageToggle } from '../components/LanguageToggle'
import { DEMO_CHATS, type DemoChat } from '../lib/demo'
import { PERSONA_NAMES } from '../lib/personas'
import { useI18n } from '../lib/i18n'

export function Landing() {
  const [picked, setPicked] = useState<DemoChat | null>(null)
  const { t, isRTL } = useI18n()

  const howItWorks = [
    { title: t.landing.step1Title, body: t.landing.step1Body },
    { title: t.landing.step2Title, body: t.landing.step2Body },
    { title: t.landing.step3Title, body: t.landing.step3Body },
  ]

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Mascot persona="brandon" size={32} />
          <span className="wordmark">Brandon Clone</span>
          <span className="topbar-spacer" />
          <LanguageToggle />
          <Link className="small" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }} to="/history">
            {t.nav.myChats}
          </Link>
          <Link className="btn" style={{ minHeight: 44, padding: '0 16px' }} to="/setup">
            {t.nav.tryNow}
          </Link>
        </div>
      </header>

      <main className="wrap">
        <section className="hero" aria-labelledby="hero-heading">
          <RingCluster />
          <h1 id="hero-heading">{t.landing.heroHeading}</h1>
          <p className="hero-sub">{t.landing.heroSub}</p>
          <Link className="btn btn-block" to="/setup">
            {t.landing.uploadCta}
          </Link>
        </section>

        <ChatMarquee selectedId={picked?.id ?? null} onPick={setPicked} />

        <section className="demo-area" aria-labelledby="demo-heading">
          <h2 id="demo-heading" className="step-title" style={{ fontSize: '1.3rem' }}>
            {t.landing.demoTitle}
          </h2>
          <div className="card" style={{ marginTop: 12 }} aria-live="polite">
            {picked ? <DemoReport chat={picked} /> : <p className="muted">{t.landing.demoSub}</p>}
          </div>
        </section>

        <section className="steps-strip" aria-labelledby="how-heading">
          <h2 id="how-heading" className="step-title" style={{ fontSize: '1.3rem' }}>
            {t.landing.howTitle}
          </h2>
          {howItWorks.map((step, i) => (
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
            {DEMO_CHATS.length} {isRTL ? 'שיחות לדוגמה, כולן מומצאות.' : 'example chats, all made up.'}
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
