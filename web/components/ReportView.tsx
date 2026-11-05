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
              <article key={`${m.name}-${i}`} className="card member-profile">
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
