import { useEffect, useState, type ReactNode } from 'react'
import { Modal } from './Modal'
import { useI18n } from '../lib/i18n'

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
  const he = useI18n().lang === 'he'
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(() => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    if (!playing || index >= STEPS.length - 1) return
    const timer = window.setTimeout(() => setIndex((i) => Math.min(i + 1, STEPS.length - 1)), 4000)
    return () => window.clearTimeout(timer)
  }, [index, playing])
  const heScreens = [
    <><div className="phone-bar">תוכניות לסופ״ש</div><div className="phone-bubble">מי מגיע בשבת?</div><div className="phone-bubble phone-bubble--out">אני!</div></>,
    <><div className="phone-bar phone-highlight">תוכניות לסופ״ש ›</div><div className="phone-bubble">פרטי הקבוצה</div></>,
    <div className="phone-menu"><span>מדיה וקישורים</span><span>השתקת התראות</span><span className="is-on">ייצוא צ׳אט</span></div>,
    <div className="phone-menu"><span className="is-on">ללא מדיה</span><span>כולל מדיה</span></div>,
    <><div className="phone-bubble phone-bubble--out">נשמר: group chat.zip</div><div className="phone-bubble">מוכן להעלאה</div></>,
    <><div className="phone-bar">Brandon Clone</div><div className="phone-bubble phone-highlight">לחצו להעלאה</div></>,
  ]
  const step = STEPS[index]
  const last = index === STEPS.length - 1
  const heSteps = [
    ['פתיחת הקבוצה', 'פתחו את הקבוצה בוואטסאפ. כאן אפשר לנתח שיחות קבוצתיות.'],
    ['פתיחת פרטי הקבוצה', 'לחצו על שם הקבוצה בראש המסך כדי לפתוח את הפרטים.'],
    ['ייצוא השיחה', 'גללו בפרטי הקבוצה ובחרו באפשרות ייצוא הצ׳אט.'],
    ['בחירה ללא מדיה', 'בחרו באפשרות ללא מדיה כדי לקבל קובץ קטן יותר.'],
    ['שמירת הקובץ', 'שמרו את הקובץ בקבצים או בהורדות. אין צורך לחלץ אותו.'],
    ['העלאה לאתר', 'חזרו לכאן, לחצו על אזור ההעלאה ובחרו את הקובץ.'],
  ]

  return (
    <Modal titleId="tutorial-title" title={he ? 'ייצוא שיחה קבוצתית ללא מדיה' : 'Export a group chat without media'} onClose={onClose}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="phone" aria-hidden="true">
          <div className="phone-screen">{he ? heScreens[index] : step.screen}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <p className="small muted">
            {he ? `שלב ${index + 1} מתוך ${STEPS.length}` : `Step ${index + 1} of ${STEPS.length}`}
          </p>
          <h3 style={{ fontSize: '1.15rem', marginTop: 4 }}>{he ? heSteps[index][0] : step.title}</h3>
          <p style={{ marginTop: 6 }}>{he ? heSteps[index][1] : step.caption}</p>
        </div>
        <div className="step-dots" aria-label={he ? 'התקדמות ההדרכה' : 'Tutorial progress'}>
          {STEPS.map((s, i) => (
            <button key={s.title} type="button" aria-label={he ? `מעבר לשלב ${i + 1}` : `Go to step ${i + 1}`} aria-current={i === index ? 'step' : undefined} onClick={() => setIndex(i)} />
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <button type="button" className="btn btn-ghost" onClick={() => setIndex(index - 1)} disabled={index === 0}>
            {he ? 'הקודם' : 'Previous'}
          </button>
          <button type="button" className="btn btn-ghost" aria-label={playing ? (he ? 'השהיית ההדרכה' : 'Pause tutorial') : (he ? 'הפעלת ההדרכה' : 'Play tutorial')} onClick={() => setPlaying(!playing)}>{playing ? (he ? 'השהיה' : 'Pause') : (he ? 'הפעלה' : 'Play')}</button>
          {last ? (
            <button type="button" className="btn" onClick={onClose}>
              {he ? 'סיום' : 'Done'}
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => setIndex(index + 1)}>
              {he ? 'הבא' : 'Next'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
