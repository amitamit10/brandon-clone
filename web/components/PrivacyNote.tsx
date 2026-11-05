export const PRIVACY_TEXT =
  'Free, for friends. The site owner can read the chats and reports uploaded here, and chats are sent to a free AI provider (Google Gemini or OpenRouter) that may keep or train on them. Uploads are deleted after 30 days.'

export function PrivacyNote({ className = '' }: { className?: string }) {
  return (
    <p className={`small muted privacy-note ${className}`.trim()} role="note">
      {PRIVACY_TEXT}
    </p>
  )
}
