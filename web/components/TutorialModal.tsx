import { useState, type ReactNode } from 'react'
import { Modal } from './Modal'

interface TutorialStep {
  title: string
  caption: string
  screen: ReactNode
}

/** Our own illustrated walkthrough, drawn with CSS. No screenshots from any app. */
const STEPS: TutorialStep[] = [
  {
    title: 'Open the group',
    caption: 'Open the group chat you want to read. One-to-one chats will not work here.',
    screen: (
      <>
        <div className="phone-bar">Weekend plans</div>
        <div className="phone-bubble">Who is in for Saturday?</div>
        <div className="phone-bubble phone-bubble--out">Me, obviously</div>
      </>
    ),
  },
  {
    title: 'Open the group info',
    caption: 'Tap the group name at the top to open its info page.',
    screen: (
      <>
        <div className="phone-bar phone-highlight">Weekend plans ›</div>
        <div className="phone-bubble">Group info is one tap away</div>
      </>
    ),
  },
  {
    title: 'Find Export chat',
    caption: 'Scroll to the bottom of the info page and tap Export chat.',
    screen: (
      <div className="phone-menu">
        <span>Media, links and docs</span>
        <span>Mute notifications</span>
        <span className="is-on">Export chat</span>
      </div>
    ),
  },
  {
    title: 'Choose Without media',
    caption: 'When asked, pick Without media. This keeps the file small and quick to upload.',
    screen: (
      <div className="phone-menu">
        <span className="is-on">Without media</span>
        <span>Include media</span>
      </div>
    ),
  },
  {
    title: 'Save the file',
    caption: 'Save the .zip to Files or Downloads. You can upload it as it is, without unzipping.',
    screen: (
      <>
        <div className="phone-bubble phone-bubble--out">Saved: group chat.zip</div>
        <div className="phone-bubble">Ready to upload</div>
      </>
    ),
  },
  {
    title: 'Upload it here',
    caption: 'Come back to this page, tap the upload area, and choose the file. That is all.',
    screen: (
      <>
        <div className="phone-bar">Brandon Clone</div>
        <div className="phone-bubble phone-highlight">Click to upload</div>
      </>
    ),
  },
]

export function TutorialModal({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0)
  const step = STEPS[index]
  const last = index === STEPS.length - 1

  return (
    <Modal titleId="tutorial-title" title="Export a group chat without media" onClose={onClose}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="phone" aria-hidden="true">
          <div className="phone-screen">{step.screen}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <p className="small muted">
            Step {index + 1} of {STEPS.length}
          </p>
          <h3 style={{ fontSize: '1.15rem', marginTop: 4 }}>{step.title}</h3>
          <p style={{ marginTop: 6 }}>{step.caption}</p>
        </div>
        <div className="step-dots" aria-label="Tutorial progress">
          {STEPS.map((s, i) => (
            <span key={s.title} aria-current={i === index ? 'step' : undefined} />
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button type="button" className="btn btn-ghost" onClick={() => setIndex(index - 1)} disabled={index === 0}>
            Previous
          </button>
          {last ? (
            <button type="button" className="btn" onClick={onClose}>
              Done
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => setIndex(index + 1)}>
              Next
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
