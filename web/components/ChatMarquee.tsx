import { DEMO_CHATS, type DemoChat } from '../lib/demo'

export interface ChatMarqueeProps {
  onPick: (chat: DemoChat) => void
  selectedId: string | null
}

const ROW_CLASSES = ['marquee-row--left', 'marquee-row--right', 'marquee-row--slow']

/** Three rows of three chats each, so every label appears once. */
const ROWS: DemoChat[][] = [0, 1, 2].map((i) => DEMO_CHATS.slice(i * 3, i * 3 + 3))

/**
 * Three drifting rows of chat pills. Each row is rendered twice so the loop is seamless;
 * the second copy is hidden from assistive tech and made inert so buttons are not duplicated.
 */
export function ChatMarquee({ onPick, selectedId }: ChatMarqueeProps) {
  return (
    <div className="marquee-group">
      {ROWS.map((chats, rowIndex) => (
        <div key={ROW_CLASSES[rowIndex]} className={`marquee-row ${ROW_CLASSES[rowIndex]}`}>
          <PillRow chats={chats} onPick={onPick} selectedId={selectedId} />
          <div aria-hidden="true" inert={true} className="marquee-copy">
            <PillRow chats={chats} onPick={onPick} selectedId={selectedId} />
          </div>
        </div>
      ))}
    </div>
  )
}

function PillRow({ chats, onPick, selectedId }: ChatMarqueeProps & { chats: DemoChat[] }) {
  return (
    <>
      {chats.map((chat) => (
        <button
          key={chat.id}
          type="button"
          className="pill"
          aria-pressed={selectedId === chat.id}
          onClick={() => onPick(chat)}
        >
          <span aria-hidden="true">{chat.emoji}</span>
          {chat.label}
        </button>
      ))}
    </>
  )
}
