import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Mascot } from '../components/Mascot'
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
          <div className="landing-avatars" aria-hidden="true">
            <span>🎉</span><span>💬</span><span>🏡</span><span className="landing-avatar-mascot"><Mascot persona="brandon" size={58} /></span><span>🐐</span><span>✨</span><span>📱</span>
          </div>
          <h1 id="hero-heading">{t.landing.heroHeading}</h1>
          <p className="hero-sub">{t.landing.heroSub}</p>
          <Link className="btn btn-block" to="/setup">
            {t.landing.uploadCta}
          </Link>
        </section>

        <section className="landing-conversation" aria-label={isRTL ? 'שיחת וואטסאפ לדוגמה' : 'Fictional WhatsApp conversation'}>
          <p className="small muted">{isRTL ? 'שיחה מומצאת לדוגמה' : 'Fictional example conversation'}</p>
          <div className="landing-chat-window" aria-hidden="true">
            <div className="landing-chat-stream">
              {[0, 1].map((copy) => <div key={copy} className="landing-chat-copy">
                {(isRTL ? [
                  ['in', 'נועם', 'אז נפגשים בשבת?', '14:06'], ['out', '', 'הזמנתי שולחן לשמונה', '14:10'],
                  ['in', 'דנה', 'רק עכשיו ראיתי 😅', '14:14'], ['out', '', 'שלחת הודעה לפני דקה', '14:18'],
                  ['in', 'דנה', 'זה משהו אחר', '14:22'], ['out', '', 'אז כולם באים?', '14:26'],
                  ['in', 'דנה', 'כן! מבטיחה', '14:30'],
                ] : [
                  ['in', 'Noam', 'Are we still on for Saturday?', '14:06'], ['out', '', 'Booked a table for eight', '14:10'],
                  ['in', 'Dana', 'Only just saw this 😅', '14:14'], ['out', '', 'You sent a message a minute ago', '14:18'],
                  ['in', 'Dana', 'That is different', '14:22'], ['out', '', 'So is everyone coming?', '14:26'],
                  ['in', 'Dana', 'Yes! Promise', '14:30'],
                ]).map(([side, sender, message, time], i) => <div className={`landing-chat-bubble ${side}`} key={i}>
                  {sender && <strong>{sender}</strong>}<span>{message}</span><time>{time}</time>
                </div>)}
              </div>)}
            </div>
          </div>
        </section>

        <section className="landing-chat-ideas" aria-labelledby="chat-ideas-title">
          <h2 id="chat-ideas-title">{isRTL ? 'איזו קבוצה מסקרנת אתכם?' : 'Which group are you curious about?'}</h2>
          <ChatMarquee selectedId={picked?.id ?? null} onPick={setPicked} />
        </section>

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
