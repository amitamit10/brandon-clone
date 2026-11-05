import type { ReactNode } from 'react'
import type { GroupReport, PersonaId } from '../../src/shared/types'
import { Mascot } from './Mascot'
import { SafeText } from './SafeText'
import { PERSONA_NAMES, REPORT_TAGLINES } from '../lib/personas'

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
  return (
    <article className="report" aria-label={report.title || 'Report'}>
      <header className="report-head stack" style={{ gap: 16 }}>
        <h1 className="display-serif report-title">{report.title}</h1>

        <div className="persona-banner">
          <Mascot persona={persona} size={56} />
          <div style={{ minWidth: 0 }}>
            <strong>{PERSONA_NAMES[persona]}</strong>
            <p className="small muted">{REPORT_TAGLINES[persona]}</p>
          </div>
        </div>

        {actions}

        <p className="small muted privacy-line">Your chat stays under your control. Delete it any time.</p>
      </header>

      <div className="report-body stack" style={{ gap: 28 }}>
        {report.intro && <SafeText className="lede" text={report.intro} />}

        {report.verdict && (
          <Section heading="Verdict" emoji="⚖️">
            <SafeText text={report.verdict} />
          </Section>
        )}

        {report.dynamic && (
          <Section heading="The group dynamic" emoji="🕸️">
            <SafeText text={report.dynamic} />
          </Section>
        )}

        {report.shiftWeekNote && (
          <Section heading="The week things changed" emoji="📈">
            <SafeText text={report.shiftWeekNote} />
          </Section>
        )}

        {report.runningJokes.length > 0 && (
          <Section heading="Running jokes" emoji="🎭">
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
              The people
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
                {m.quote && <blockquote className="safe-quote member-quote">{m.quote}</blockquote>}
                {memberAction?.(m.name)}
              </article>
            ))}
          </section>
        )}

        {report.advice && (
          <Section heading="What to do next" emoji="✅">
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
