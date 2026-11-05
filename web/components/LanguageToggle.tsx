import { useI18n } from '../lib/i18n'

export function LanguageToggle() {
  const { lang, setLang } = useI18n()

  return (
    <button
      type="button"
      className="btn"
      onClick={() => setLang(lang === 'en' ? 'he' : 'en')}
      style={{
        padding: '6px 12px',
        fontSize: '0.85rem',
        fontWeight: 600,
        height: 'auto',
        minHeight: 36,
        background: 'var(--panel-bg, #fff)',
        border: '1.5px solid var(--border, #e5e7eb)',
        color: 'var(--ink, #1f2937)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        cursor: 'pointer',
      }}
      title={lang === 'en' ? 'החלף לעברית' : 'Switch to English'}
      aria-label={lang === 'en' ? 'Switch to Hebrew' : 'החלף לאנגלית'}
    >
      <span aria-hidden="true">{lang === 'en' ? '🇮🇱' : '🇺🇸'}</span>
      <span>{lang === 'en' ? 'עברית' : 'English'}</span>
    </button>
  )
}
