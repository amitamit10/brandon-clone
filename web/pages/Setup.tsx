import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PersonaId } from '../../src/shared/types'
import { applyNameMap, renameParticipant } from '../lib/nameMap'
import { isValidName, loadUploaderName } from '../lib/uploaderName'
import { reanalyze, type Analyzed } from '../lib/analyze'
import { UploadStep } from './setup/UploadStep'
import { MembersStep } from './setup/MembersStep'
import { NamesStep } from './setup/NamesStep'
import { PersonStep } from './setup/PersonStep'
import { StartStep } from './setup/StartStep'

const TOTAL_STEPS = 5

/**
 * Five-step wizard. The chat is analysed in the browser; only the derived stats and
 * chunks are sent to the server when the report is started.
 */
export function Setup() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [original, setOriginal] = useState<Analyzed | null>(null)
  const [fileName, setFileName] = useState('')
  const [groupName, setGroupName] = useState('')
  const [names, setNames] = useState<Map<string, string>>(() => new Map())
  const [me, setMe] = useState<string | null>(null)
  const [persona, setPersona] = useState<PersonaId>('brandon')
  const [language, setLanguage] = useState<string | null>('English')
  const [uploaderName, setUploaderName] = useState<string>(() => loadUploaderName())

  // Stats and chunks follow the renames, so merged people are counted together.
  const renamed = useMemo(
    () => (original ? reanalyze(applyNameMap(original.chat, names)) : null),
    [original, names],
  )
  const participants = renamed?.chat.participants ?? []
  const meValid = me !== null && participants.includes(me)

  const canContinue =
    step === 1
      ? original !== null && isValidName(uploaderName)
      : step === 2
        ? groupName.trim().length > 0
        : step === 3
          ? true
          : step === 4
            ? meValid && language !== null
            : false

  const handleAnalyzed = (result: Analyzed, name: string) => {
    setOriginal(result)
    setFileName(name)
    setNames(new Map())
    setMe(null)
  }

  const renameOne = (from: string, to: string) => {
    if (!original) return
    setNames((prev) => renameParticipant(original.chat, prev, from, to))
  }

  const mergeMany = (from: string[], keep: string) => {
    if (!original) return
    setNames((prev) => from.reduce((acc, name) => renameParticipant(original.chat, acc, name, keep), prev))
  }

  const back = () => (step === 1 ? navigate('/') : setStep(step - 1))

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner" style={{ flexWrap: 'wrap', paddingBottom: 10 }}>
          <button type="button" className="icon-btn" onClick={back} aria-label="Back">
            ←
          </button>
          <span className="topbar-spacer" />
          <span className="small muted" aria-live="polite">
            {step} of {TOTAL_STEPS}
          </span>
          <div className="progress" style={{ width: '100%' }} role="progressbar" aria-label="Setup progress" aria-valuemin={1} aria-valuemax={TOTAL_STEPS} aria-valuenow={step}>
            <span style={{ width: `${(step / TOTAL_STEPS) * 100}%` }} />
          </div>
        </div>
      </header>

      <main className="wrap wizard-main">
        <div key={step} className="step-enter">
          {step === 1 && (
            <UploadStep
              analysed={original}
              fileName={fileName}
              onAnalysed={handleAnalyzed}
              uploaderName={uploaderName}
              onUploaderName={setUploaderName}
            />
          )}
          {step === 2 && renamed && (
            <MembersStep
              analysed={renamed}
              groupName={groupName}
              onGroupName={setGroupName}
              onMerge={mergeMany}
            />
          )}
          {step === 3 && original && (
            <NamesStep participants={participants} onRename={renameOne} />
          )}
          {step === 4 && (
            <PersonStep
              participants={participants}
              me={meValid ? me : null}
              onMe={setMe}
              persona={persona}
              onPersona={setPersona}
              language={language}
              onLanguage={setLanguage}
            />
          )}
          {step === 5 && renamed && (
            <StartStep
              groupName={groupName}
              analysed={renamed}
              me={meValid ? me : null}
              persona={persona}
              language={language}
              uploaderName={uploaderName}
            />
          )}
        </div>
      </main>

      {step < TOTAL_STEPS && (
        <div className="wizard-footer">
          <button
            type="button"
            className="btn"
            disabled={!canContinue}
            onClick={() => setStep(step + 1)}
          >
            {step === 2 && groupName.trim().length === 0 ? 'Name the group to continue' : 'Continue'}
          </button>
        </div>
      )}
    </>
  )
}
