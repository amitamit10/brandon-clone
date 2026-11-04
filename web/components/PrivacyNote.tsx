export const PRIVACY_TEXT =
  'Free, for friends. Chats are sent to a free-tier AI provider that may use prompts for training.'

export function PrivacyNote({ className = '' }: { className?: string }) {
  return (
    <p className={`small muted privacy-note ${className}`.trim()} role="note">
      {PRIVACY_TEXT}
    </p>
  )
}
