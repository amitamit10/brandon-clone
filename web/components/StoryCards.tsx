import { useState } from 'react'
import type { ChatExtras, ChatStats } from '../../src/shared/types'
import { pastelFor } from '../lib/palette'
import {
  calendarGrid,
  donutSegments,
  formatClock,
  formatDay,
  formatIsoDay,
  laughRows,
  rhythm,
  shareOfVoice,
  starters,
} from '../lib/story'

export const STORY_TITLES = [
  'Your years, day by day',
  'Who talks, who starts',
  'Your rhythm',
  'The longest message',
  'It all started here',
  'And for now, it ends here',
  'Your words',
] as const

export const STORY_COUNT = STORY_TITLES.length

export interface StoryProps {
  stats: ChatStats
  extras: ChatExtras
}

/** Renders one story card (1 to 7). Every value comes from stats or extras; names are plain text. */
export function StoryCard({ index, stats, extras }: StoryProps & { index: number }) {
  const title = STORY_TITLES[index - 1] ?? STORY_TITLES[0]
  const body =
    index === 1 ? <YearsCard stats={stats} extras={extras} />
    : index === 2 ? <VoiceCard stats={stats} />
    : index === 3 ? <RhythmCard stats={stats} extras={extras} />
    : index === 4 ? <LongestCard extras={extras} />
    : index === 5 ? <EdgeCard kind="first" stats={stats} extras={extras} />
    : index === 6 ? <EdgeCard kind="last" stats={stats} extras={extras} />
    : <WordsCard extras={extras} />
  return (
    <section className="story-card" aria-labelledby={`story-title-${index}`}>
      <p className="small muted story-kicker">Card {index} of {STORY_COUNT}</p>
      <h2 id={`story-title-${index}`} className="story-title">
        {title}
      </h2>
      {body}
    </section>
  )
}

function colourIndexOf(stats: ChatStats, name: string): number {
  const i = Object.keys(stats.perMember).indexOf(name)
  return i < 0 ? 0 : i
}

// ---- 1: calendar heatmap ----

const HEAT_OPACITY = [0.08, 0.3, 0.5, 0.75, 1] as const

function YearsCard({ stats, extras }: StoryProps) {
  const grid = calendarGrid(extras, stats.firstTs, stats.lastTs)
  const summary = `${grid.activeDays} days with messages. Busiest day ${formatIsoDay(stats.busiestDay.date)} with ${stats.busiestDay.count} messages.`
  return (
    <div className="tile story-dark" style={{ background: '#0e0e10', color: '#fff' }}>
      <div className="heat" role="img" aria-label={summary}>
        {grid.months.map((month) => (
          <div key={month.key} className="heat-row">
            <span className="heat-label">{month.label}</span>
            {month.cells.map((cell, i) =>
              cell === null ? (
                <span key={i} className="heat-cell heat-empty" />
              ) : (
                <span
                  key={i}
                  className="heat-cell"
                  title={`${formatIsoDay(cell.date)}: ${cell.count}`}
                  style={{ opacity: HEAT_OPACITY[cell.level] }}
                />
              ),
            )}
          </div>
        ))}
      </div>
      <p className="small story-note">{summary}</p>
    </div>
  )
}

// ---- 2: share of voice and starters ----

const DONUT_COLOURS = ['#d9ccff', '#ffc6dc', '#ffd2b8', '#bdf2de', '#ffeaa7', '#e6e6e6'] as const

function VoiceCard({ stats }: { stats: ChatStats }) {
  const voice = shareOfVoice(stats)
  const segments = donutSegments(voice)
  const starterRows = starters(stats)
  const maxStarter = Math.max(1, ...starterRows.map((r) => r.starters))
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="tile tile-lilac">
        <h3 className="story-sub">Share of voice</h3>
        <div className="voice">
          <svg viewBox="0 0 100 100" className="donut" role="img" aria-label="Share of messages by person">
            {segments.map((s) => (
              <path key={s.name} d={s.path} fill="none" stroke={DONUT_COLOURS[s.colorIndex % DONUT_COLOURS.length]} strokeWidth="14" />
            ))}
          </svg>
          <ol className="voice-list">
            {voice.map((row, i) => (
              <li key={row.name}>
                <span className="dot" style={{ background: DONUT_COLOURS[i % DONUT_COLOURS.length] }} aria-hidden="true" />
                <span className="voice-name">{row.name}</span>
                <span className="small">{row.percent}%</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="tile tile-pink">
        <h3 className="story-sub">Who starts the conversation</h3>
        <ul className="bars">
          {starterRows.map((row) => (
            <li key={row.name}>
              <span className="bar-label">
                <span>{row.name}</span>
                <span className="small">{row.percent}%</span>
              </span>
              <span className="bar-track" aria-hidden="true">
                <span style={{ width: `${(row.starters / maxStarter) * 100}%`, background: pastelFor(colourIndexOf(stats, row.name)) }} />
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// ---- 3: rhythm ----

function RhythmCard({ stats, extras }: StoryProps) {
  const r = rhythm(stats, extras)
  const maxHour = Math.max(1, ...r.hours)
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="grid-2">
        <div className="tile tile-butter">
          <span className="small muted">Record day</span>
          <strong className="story-big">{r.recordDay.count.toLocaleString('en-US')}</strong>
          <span className="small">messages on {formatIsoDay(r.recordDay.date)}</span>
        </div>
        <div className="tile tile-mint">
          <span className="small muted">Streak</span>
          <strong className="story-big">{r.streakDays}</strong>
          <span className="small">
            {r.streakDays === 1 ? 'day' : 'days'} in a row
            {r.streakDays > 0 ? `, ${formatIsoDay(r.streakFrom)} to ${formatIsoDay(r.streakTo)}` : ''}
          </span>
        </div>
      </div>
      <div className="tile tile-peach">
        <span className="small muted">Longest silence</span>
        <strong className="story-big">
          {r.silenceDays} {r.silenceDays === 1 ? 'day' : 'days'}
        </strong>
        <span className="small">
          from {r.silenceFrom} to {r.silenceTo}
        </span>
      </div>
      <div className="tile tile-lilac">
        <h3 className="story-sub">By hour</h3>
        <p className="small">
          {r.lateNightPercent}% after 10pm · peak at {String(r.peakHour).padStart(2, '0')}:00
        </p>
        <div className="hours" role="img" aria-label={`Messages per hour, peak at ${r.peakHour}:00`}>
          {r.hours.map((n, h) => (
            <span key={h} className="hour-bar" style={{ height: `${Math.max(4, (n / maxHour) * 100)}%` }} />
          ))}
        </div>
        <div className="hours-axis small muted" aria-hidden="true">
          <span>00</span>
          <span>12</span>
          <span>23</span>
        </div>
      </div>
    </div>
  )
}

// ---- 4: longest messages ----

const PREVIEW_CHARS = 180

function LongestCard({ extras }: { extras: ChatExtras }) {
  if (extras.longestMessages.length === 0) return <p className="small muted">No text messages to show.</p>
  return (
    <div className="stack" style={{ gap: 12 }}>
      {extras.longestMessages.map((m) => (
        <LongMessage key={m.sender} sender={m.sender} words={m.words} ts={m.ts} text={m.text} />
      ))}
    </div>
  )
}

function LongMessage({ sender, words, ts, text }: { sender: string; words: number; ts: number; text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > PREVIEW_CHARS
  const shown = open || !long ? text : `${text.slice(0, PREVIEW_CHARS)}…`
  return (
    <article className="tile tile-pink story-message">
      <header className="story-message-head">
        <strong>{sender}</strong>
        <span className="small">
          {words.toLocaleString('en-US')} words · {formatDay(ts)}
        </span>
      </header>
      <p className="bubble-text" dir="auto">{shown}</p>
      {long && (
        <button type="button" className="link-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'See less' : 'See more'}
        </button>
      )}
    </article>
  )
}

// ---- 5 and 6: first and last messages ----

function EdgeCard({ kind, stats, extras }: StoryProps & { kind: 'first' | 'last' }) {
  const items = kind === 'first' ? extras.firstMessages : extras.lastMessages
  const ts = kind === 'first' ? stats.firstTs : stats.lastTs
  return (
    <div className="stack" style={{ gap: 12 }}>
      <p className="small muted">{formatDay(ts)}</p>
      <div className="tile tile-lilac bubble-column">
        {items.length === 0 && <p className="small muted">No text messages to show.</p>}
        {items.map((m, i) => (
          <div key={`${m.ts}-${i}`} className="bubble">
            <span className="bubble-sender" style={{ color: '#4a3a8a' }}>
              {m.sender}
              <span className="small muted"> · {formatClock(m.ts)}</span>
            </span>
            <span className="bubble-text" dir="auto">{m.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---- 7: laughs, words, emojis ----

function WordsCard({ extras }: { extras: ChatExtras }) {
  const laughs = laughRows(extras.laughs)
  const maxLaugh = Math.max(1, ...laughs.map((r) => r.count))
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="tile tile-butter">
        <h3 className="story-sub">Laugh print</h3>
        {laughs.length === 0 ? (
          <p className="small muted">No laughs counted.</p>
        ) : (
          <ul className="bars">
            {laughs.map((row) => (
              <li key={row.sender}>
                <span className="bar-label">
                  <span>{row.sender}</span>
                  <span className="small">{row.count.toLocaleString('en-US')}</span>
                </span>
                <span className="bar-track" aria-hidden="true">
                  <span style={{ width: `${(row.count / maxLaugh) * 100}%` }} />
                </span>
              </li>
            ))}
          </ul>
        )}
        {extras.laughRecord.length > 0 && (
          <p className="small" style={{ marginTop: 8 }}>
            Record: {extras.laughRecord.length} letters in one laugh, by {extras.laughRecord.sender}.
          </p>
        )}
      </div>
      <div className="grid-2">
        <div className="tile tile-mint">
          <h3 className="story-sub">Most used words</h3>
          <ol className="plain-list">
            {extras.topWords.map(([word, n]) => (
              <li key={word}>
                <span>{word}</span> <span className="small muted">{n}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="tile tile-peach">
          <h3 className="story-sub">Most used emojis</h3>
          <ol className="plain-list emoji-list">
            {extras.topEmojis.map(([emoji, n]) => (
              <li key={emoji}>
                <span aria-hidden="true">{emoji}</span> <span className="small muted">{n}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  )
}
