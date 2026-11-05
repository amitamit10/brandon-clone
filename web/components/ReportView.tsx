import type { ReactNode } from 'react'
import type { GroupReport, PersonaId } from '../../src/shared/types'
import { Mascot } from './Mascot'
import { SafeText } from './SafeText'
import { PERSONA_NAMES, REPORT_TAGLINES } from '../lib/personas'
import { useI18n } from '../lib/i18n'

export interface ReportViewProps {
  report: GroupReport
  persona: PersonaId
  /** private page only: share, follow-up and delete controls */
  actions?: ReactNode
  /** private page only: a control next to each member, for example a deep dive */
  memberAction?: (name: string) => ReactNode
}

/**
 * The report body, shared by the private and the shared page. Model text goes through SafeText;
 * names, titles and quotes are plain React text, so nothing is ever parsed as markup.
 */
export function ReportView({ report, persona, actions, memberAction }: ReportViewProps) {
  const { t, lang } = useI18n()

  const personaName = lang === 'he'
    ? (persona === 'brandon' ? t.personas.brandonName : persona === 'clara' ? t.personas.claraName : t.personas.diegoName)
    : PERSONA_NAMES[persona]

  const personaTagline = lang === 'he'
    ? (persona === 'brandon' ? t.personas.brandonReportTagline : persona === 'clara' ? t.personas.claraReportTagline : t.personas.diegoReportTagline)
    : REPORT_TAGLINES[persona]

  return (
    <article className="report" aria-label={report.title || 'Report'}>
      <header className="report-head stack" style={{ gap: 16 }}>
        <h1 className="display-serif report-title">{report.title}</h1>

        <div className="persona-banner">
          <Mascot persona={persona} size={56} />
          <div style={{ minWidth: 0 }}>
            <strong>{personaName}</strong>
            <p className="small muted">{personaTagline}</p>
          </div>
        </div>

        {actions}

        <p className="small muted privacy-line">
          {lang === 'he' ? t.report.controlLine : 'Your chat stays under your control. Delete it any time.'}
        </p>
      </header>

      <div className="report-body stack" style={{ gap: 28 }}>
        {report.intro && <SafeText className="lede" text={report.intro} />}

        {report.verdict && (
          <Section heading={lang === 'he' ? t.report.verdict : 'Verdict'} emoji="⚖️">
            <SafeText text={report.verdict} />
          </Section>
        )}

        <AuraPodium members={report.members} t={t} lang={lang} />

        {report.dynamic && (
          <Section heading={lang === 'he' ? t.report.groupDynamic : 'The group dynamic'} emoji="🕸️">
            <SafeText text={report.dynamic} />
          </Section>
        )}

        {report.shiftWeekNote && (
          <Section heading={lang === 'he' ? t.report.shiftWeek : 'The week things changed'} emoji="📈">
            <SafeText text={report.shiftWeekNote} />
          </Section>
        )}

        {report.runningJokes.length > 0 && (
          <Section heading={lang === 'he' ? t.report.runningJokes : 'Running jokes'} emoji="🎭">
            <ul className="jokes">
              {report.runningJokes.map((joke, i) => (
                <li key={i}>
                  <SafeText text={joke} />
                </li>
              ))}
            </ul>
          </Section>
        )}

        {report.sections.map((section, i) => (
          <Section key={i} heading={section.heading} emoji={section.emoji}>
            <SafeText text={section.body} />
          </Section>
        ))}

        {report.members.length > 0 && (
          <section className="stack" style={{ gap: 14 }} aria-labelledby="people-heading">
            <h2 id="people-heading" className="report-h2">
              {lang === 'he' ? t.report.thePeople : 'The people'}
            </h2>
            {report.members.map((m, i) => (
              <article id={`member-${encodeURIComponent(m.name)}`} key={`${m.name}-${i}`} className="card member-profile">
                <header className="member-profile-head">
                  <span className="member-number" aria-hidden="true">
                    {i + 1}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <h3 className="member-name">{m.name}</h3>
                    {m.nickname && <p className="small muted">“{m.nickname}”</p>}
                  </div>
                </header>
                <SafeText text={m.opinion} />

                {m.roast && (
                  <div className="member-roast-callout" dir="auto">
                    <div className="roast-callout-header">
                      <span aria-hidden="true">🔥</span>
                      <strong>{lang === 'he' ? 'הרוסט של ברנדון' : "Brandon's Roast"}</strong>
                    </div>
                    <p className="roast-callout-text">{m.roast}</p>
                  </div>
                )}

                {(m.smurf || m.animal || m.charisma || m.favoriteCurse || m.selfImage || m.futurePrediction) && (
                  <div className="member-traits-grid" dir="auto">
                    {m.smurf && (
                      <div className="trait-pill trait-smurf">
                        <span className="trait-icon" aria-hidden="true">🍄</span>
                        <div className="trait-body">
                          <span className="trait-kicker">{lang === 'he' ? 'דרדס מייצג' : 'Smurf'}</span>
                          <span className="trait-text">{m.smurf}</span>
                        </div>
                      </div>
                    )}

                    {m.animal && (
                      <div className="trait-pill trait-animal">
                        <span className="trait-icon" aria-hidden="true">🐾</span>
                        <div className="trait-body">
                          <span className="trait-kicker">{lang === 'he' ? 'חיה מייצגת' : 'Spirit Animal'}</span>
                          <span className="trait-text">{m.animal}</span>
                        </div>
                      </div>
                    )}

                    {m.charisma && (
                      <div className="trait-pill trait-charisma">
                        <span className="trait-icon" aria-hidden="true">✨</span>
                        <div className="trait-body">
                          <span className="trait-kicker">{lang === 'he' ? 'מדד כריזמה' : 'Charisma'}</span>
                          <span className="trait-text">{m.charisma}</span>
                        </div>
                      </div>
                    )}

                    {m.favoriteCurse && (
                      <div className="trait-pill trait-curse">
                        <span className="trait-icon" aria-hidden="true">🤬</span>
                        <div className="trait-body">
                          <span className="trait-kicker">{lang === 'he' ? 'קללה / ביטוי אהוב' : 'Favorite Curse'}</span>
                          <span className="trait-text">“{m.favoriteCurse}”</span>
                        </div>
                      </div>
                    )}

                    {m.selfImage && (
                      <div className="trait-pill trait-self-image">
                        <span className="trait-icon" aria-hidden="true">🪞</span>
                        <div className="trait-body">
                          <span className="trait-kicker">{lang === 'he' ? 'איך הוא חושב שהוא נראה' : 'Self-Image vs Reality'}</span>
                          <span className="trait-text">{m.selfImage}</span>
                        </div>
                      </div>
                    )}

                    {m.futurePrediction && (
                      <div className="trait-pill trait-future">
                        <span className="trait-icon" aria-hidden="true">🔮</span>
                        <div className="trait-body">
                          <span className="trait-kicker">{lang === 'he' ? 'מה יעשה בעתיד' : 'Future Prediction'}</span>
                          <span className="trait-text">{m.futurePrediction}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {m.quote && (
                  <blockquote dir="auto" className="safe-quote member-quote whatsapp-bubble-wrap">
                    <div className="whatsapp-bubble">
                      <span className="whatsapp-bubble-tail" aria-hidden="true">
                        <svg viewBox="0 0 22 18" fill="currentColor">
                          <path d="M22 0V18H11C7.4 18 3.6 16.4 0.6 13.6C6.2 12.4 8.7 8.7 9.8 4.6C10.6 1.7 15.8 0 22 0Z" />
                        </svg>
                      </span>
                      <div className="whatsapp-bubble-content">
                        {m.quote}
                      </div>
                      <span className="whatsapp-checks" aria-hidden="true">
                        <svg viewBox="0 0 16 15" fill="currentColor">
                          <path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.88a.32.32 0 0 1-.484.033l-.358-.325a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l1.32 1.266c.143.14.361.125.484-.033l6.272-8.048a.366.366 0 0 0-.064-.512zm-4.1 0-.478-.372a.365.365 0 0 0-.51.063L4.566 9.88a.32.32 0 0 1-.484.033L1.891 7.769a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l3.013 2.928c.143.14.361.125.484-.033l6.272-8.048a.366.366 0 0 0-.064-.512z" />
                        </svg>
                      </span>
                    </div>
                  </blockquote>
                )}
                {m.aura && <AuraCard aura={m.aura} lang={lang} t={t} />}
                {memberAction?.(m.name)}
              </article>
            ))}
          </section>
        )}

        {report.advice && (
          <Section heading={lang === 'he' ? 'מה לעשות עכשיו' : 'What to do next'} emoji="✅">
            <SafeText text={report.advice} />
          </Section>
        )}
      </div>
    </article>
  )
}

function Section({ heading, emoji, children }: { heading: string; emoji: string; children: ReactNode }) {
  return (
    <section className="stack report-section" style={{ gap: 10 }}>
      <h2 className="report-h2">
        {emoji && (
          <span aria-hidden="true" className="report-emoji">
            {emoji}{' '}
          </span>
        )}
        {heading}
      </h2>
      {children}
    </section>
  )
}

function AuraCard({
  aura,
  t,
}: {
  aura: NonNullable<GroupReport['members'][0]['aura']>
  lang: string
  t: ReturnType<typeof useI18n>['t']
}) {
  const isPositive = !aura.score.trim().startsWith('-')
  return (
    <div className={`aura-meter-card ${isPositive ? 'aura-positive' : 'aura-negative'}`} dir="auto">
      <div className="aura-header">
        <div className="aura-score-pill">
          <span className="aura-emoji" aria-hidden="true">
            {isPositive ? '⚡' : '📉'}
          </span>
          <strong>{aura.score}</strong>
          <span className="aura-label">{t.report.auraScore}</span>
        </div>
        {aura.status && <span className="aura-status">{aura.status}</span>}
      </div>

      <div className="aura-moments stack" style={{ gap: 10, marginTop: 12 }}>
        {aura.peak && (
          <div className="aura-moment aura-moment-peak">
            <div className="aura-moment-title">
              <span className="aura-badge-plus">{aura.peak.points}</span>
              <span>{aura.peak.reason}</span>
            </div>
            {aura.peak.quote && (
              <>
                <p className="small muted" style={{ margin: '6px 0 2px' }}>
                  {t.report.auraGainHere.replace('{points}', aura.peak.points)}
                </p>
                <blockquote dir="auto" className="safe-quote member-quote whatsapp-bubble-wrap aura-quote-peak">
                  <div className="whatsapp-bubble">
                    <span className="whatsapp-bubble-tail" aria-hidden="true">
                      <svg viewBox="0 0 22 18" fill="currentColor">
                        <path d="M22 0V18H11C7.4 18 3.6 16.4 0.6 13.6C6.2 12.4 8.7 8.7 9.8 4.6C10.6 1.7 15.8 0 22 0Z" />
                      </svg>
                    </span>
                    <div className="whatsapp-bubble-content">{aura.peak.quote}</div>
                    <span className="whatsapp-checks" aria-hidden="true">
                      <svg viewBox="0 0 16 15" fill="currentColor">
                        <path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.88a.32.32 0 0 1-.484.033l-.358-.325a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l1.32 1.266c.143.14.361.125.484-.033l6.272-8.048a.366.366 0 0 0-.064-.512zm-4.1 0-.478-.372a.365.365 0 0 0-.51.063L4.566 9.88a.32.32 0 0 1-.484.033L1.891 7.769a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l3.013 2.928c.143.14.361.125.484-.033l6.272-8.048a.366.366 0 0 0-.064-.512z" />
                      </svg>
                    </span>
                  </div>
                </blockquote>
              </>
            )}
          </div>
        )}

        {aura.loss && (
          <div className="aura-moment aura-moment-loss">
            <div className="aura-moment-title">
              <span className="aura-badge-minus">{aura.loss.points}</span>
              <span>{aura.loss.reason}</span>
            </div>
            {aura.loss.quote && (
              <>
                <p className="small muted" style={{ margin: '6px 0 2px' }}>
                  {t.report.auraLossHere.replace('{points}', aura.loss.points)}
                </p>
                <blockquote dir="auto" className="safe-quote member-quote whatsapp-bubble-wrap aura-quote-loss">
                  <div className="whatsapp-bubble">
                    <span className="whatsapp-bubble-tail" aria-hidden="true">
                      <svg viewBox="0 0 22 18" fill="currentColor">
                        <path d="M22 0V18H11C7.4 18 3.6 16.4 0.6 13.6C6.2 12.4 8.7 8.7 9.8 4.6C10.6 1.7 15.8 0 22 0Z" />
                      </svg>
                    </span>
                    <div className="whatsapp-bubble-content">{aura.loss.quote}</div>
                    <span className="whatsapp-checks" aria-hidden="true">
                      <svg viewBox="0 0 16 15" fill="currentColor">
                        <path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.88a.32.32 0 0 1-.484.033l-.358-.325a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l1.32 1.266c.143.14.361.125.484-.033l6.272-8.048a.366.366 0 0 0-.064-.512zm-4.1 0-.478-.372a.365.365 0 0 0-.51.063L4.566 9.88a.32.32 0 0 1-.484.033L1.891 7.769a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l3.013 2.928c.143.14.361.125.484-.033l6.272-8.048a.366.366 0 0 0-.064-.512z" />
                      </svg>
                    </span>
                  </div>
                </blockquote>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function parseAuraScore(raw?: string): number {
  if (!raw) return 0
  const clean = raw.replace(/[,\s]/g, '').toLowerCase()
  if (clean.includes('infinity') || clean.includes('אינסוף')) return 999999
  const match = clean.match(/[-+]?\d+/)
  return match ? parseInt(match[0], 10) : 0
}

function AuraPodium({
  members,
  t,
}: {
  members: GroupReport['members']
  lang: string
  t: ReturnType<typeof useI18n>['t']
}) {
  const withAura = members.filter((m) => m.aura && m.aura.score)
  if (withAura.length < 2) return null

  const sorted = [...withAura].sort((a, b) => parseAuraScore(b.aura?.score) - parseAuraScore(a.aura?.score))
  const first = sorted[0]
  const second = sorted[1]
  const third = sorted[2]

  const lowest = sorted[sorted.length - 1]
  const hasDebtor = lowest && lowest !== first && lowest !== second && parseAuraScore(lowest.aura?.score) < 0

  const scrollToMember = (name: string) => {
    const el = document.getElementById(`member-${encodeURIComponent(name)}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('highlight-glow')
      setTimeout(() => el.classList.remove('highlight-glow'), 2000)
    }
  }

  return (
    <section className="card aura-podium-card" aria-label={t.report.auraPodiumTitle}>
      <header className="aura-podium-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="aura-trophy" aria-hidden="true">
            🏆
          </span>
          <div>
            <h3 className="report-h3 podium-header-title" style={{ margin: 0, fontSize: '1.2rem' }}>
              {t.report.auraPodiumTitle}
            </h3>
            <p className="small podium-header-sub" style={{ margin: 0 }}>
              {t.report.auraPodiumSub}
            </p>
          </div>
        </div>
      </header>

      <div className="podium-grid">
        {/* 2nd Place */}
        {second && (
          <div
            className="podium-col podium-2"
            onClick={() => scrollToMember(second.name)}
            role="button"
            tabIndex={0}
            title={second.name}
          >
            <div className="podium-avatar">🥈</div>
            <span className="podium-name" dir="auto">{second.name}</span>
            <span className="podium-score podium-score-silver" dir="auto">{second.aura?.score}</span>
            <div className="podium-pillar pillar-2">
              <span className="podium-rank">2</span>
            </div>
          </div>
        )}

        {/* 1st Place (Center) */}
        {first && (
          <div
            className="podium-col podium-1"
            onClick={() => scrollToMember(first.name)}
            role="button"
            tabIndex={0}
            title={first.name}
          >
            <span className="podium-crown" aria-hidden="true">
              👑
            </span>
            <div className="podium-avatar">🥇</div>
            <strong className="podium-name" dir="auto">{first.name}</strong>
            <span className="podium-badge-champ">{t.report.auraChampion}</span>
            <span className="podium-score podium-score-gold" dir="auto">{first.aura?.score}</span>
            <div className="podium-pillar pillar-1">
              <span className="podium-rank">1</span>
            </div>
          </div>
        )}

        {/* 3rd Place */}
        {third && (
          <div
            className="podium-col podium-3"
            onClick={() => scrollToMember(third.name)}
            role="button"
            tabIndex={0}
            title={third.name}
          >
            <div className="podium-avatar">🥉</div>
            <span className="podium-name" dir="auto">{third.name}</span>
            <span className="podium-score podium-score-bronze" dir="auto">{third.aura?.score}</span>
            <div className="podium-pillar pillar-3">
              <span className="podium-rank">3</span>
            </div>
          </div>
        )}
      </div>

      {hasDebtor && (
        <div
          className="podium-debtor-row"
          onClick={() => scrollToMember(lowest.name)}
          role="button"
          tabIndex={0}
          title={lowest.name}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="podium-debtor-skull" aria-hidden="true">💀</span>
            <div>
              <strong className="podium-debtor-title">
                {t.report.auraDebtor}: {lowest.name}
              </strong>
              <div className="podium-debtor-status">
                {lowest.aura?.status || 'Aura Bankruptcy'}
              </div>
            </div>
          </div>
          <span className="aura-badge-minus podium-debtor-score">{lowest.aura?.score}</span>
        </div>
      )}
    </section>
  )
}
