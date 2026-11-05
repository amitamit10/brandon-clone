import { useState, type DragEvent } from 'react'
import { analyzeFile, type Analyzed } from '../../lib/analyze'
import { uploadErrorMessage } from '../../lib/messages'
import { PrivacyNote } from '../../components/PrivacyNote'
import { TutorialModal } from '../../components/TutorialModal'

export interface UploadStepProps {
  analysed: Analyzed | null
  fileName: string
  onAnalysed: (result: Analyzed, fileName: string) => void
  uploaderName: string
  onUploaderName: (name: string) => void
}

export function qualityLabel(messageCount: number): string {
  if (messageCount >= 5000) return 'Excellent signal'
  if (messageCount >= 500) return 'Good signal'
  return 'Thin'
}

export function UploadStep({ analysed, fileName, onAnalysed, uploaderName, onUploaderName }: UploadStepProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorKey, setErrorKey] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false)

  const handleFile = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const result = await analyzeFile(file)
      onAnalysed(result, file.name)
    } catch (e) {
      setError(uploadErrorMessage(e))
      setErrorKey((k) => k + 1)
    } finally {
      setBusy(false)
    }
  }

  const onDragOver = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault()
    setDragging(true)
  }

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) void handleFile(file)
  }

  const fileInput = (
    <input
      type="file"
      accept=".zip,.txt,application/zip,text/plain"
      aria-label="Chat export file"
      onChange={(e) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (file) void handleFile(file)
      }}
    />
  )

  return (
    <div className="stack">
      <div>
        <h1 className="step-title">Upload your chat</h1>
        <p className="step-sub">Export a WhatsApp group chat without media, then add the .zip or .txt here.</p>
      </div>

      <label className="stack" style={{ gap: 6 }}>
        <span style={{ fontWeight: 700 }}>Your name</span>
        <input
          className="field"
          type="text"
          maxLength={60}
          autoComplete="name"
          value={uploaderName}
          onChange={(e) => onUploaderName(e.target.value)}
          placeholder="Your name"
        />
      </label>

      {analysed ? (
        <label className="drop-ready" onDragOver={onDragOver} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
          {fileInput}
          <span className="small" style={{ fontWeight: 700 }}>
            {fileName}
          </span>
          <span className="big-count" aria-label={`${analysed.messageCount} messages`}>
            {analysed.messageCount.toLocaleString('en-US')}
          </span>
          <span>messages</span>
          <span className="quality">{qualityLabel(analysed.messageCount)}</span>
          <span className="small">Click to change the conversation</span>
          <span className="small" style={{ opacity: 0.8 }}>
            Was this exported without media? WhatsApp includes less history when media is attached.
          </span>
        </label>
      ) : (
        <label
          className={`drop${dragging ? ' is-dragging' : ''}`}
          onDragOver={onDragOver}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          {fileInput}
          <ZipIcon />
          <strong style={{ fontSize: '1.1rem' }}>Click to upload</strong>
          <span className="muted">or drag and drop</span>
          <span className={`small muted${busy ? ' pulse' : ''}`} role="status">
            {busy ? 'Reading your chat…' : '.zip or .txt, up to 10 MB'}
          </span>
        </label>
      )}

      {error && (
        <p key={errorKey} role="alert" className="field-error shake">
          {error}
        </p>
      )}

      <button type="button" className="tutorial-row" onClick={() => setTutorialOpen(true)}>
        See the tutorial
        <span aria-hidden="true">›</span>
      </button>

      <PrivacyNote />

      {tutorialOpen && <TutorialModal onClose={() => setTutorialOpen(false)} />}
    </div>
  )
}

function ZipIcon() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
      <rect x="10" y="6" width="36" height="44" rx="6" fill="#fff" stroke="#111" strokeWidth="2.5" />
      <rect x="25" y="6" width="6" height="30" fill="#4a8ff5" />
      <rect x="25" y="10" width="6" height="4" fill="#111" />
      <rect x="25" y="18" width="6" height="4" fill="#111" />
      <rect x="25" y="26" width="6" height="4" fill="#111" />
      <rect x="21" y="38" width="14" height="8" rx="2" fill="#ffc6dc" stroke="#111" strokeWidth="2" />
    </svg>
  )
}
