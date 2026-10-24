import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useI18n } from '../i18n'

/**
 * Asks the map question. onSubmit resolves true when the answer opened the
 * routes; the dialog then closes itself through onClose.
 */
export function MapLock({
  question,
  onSubmit,
  onClose,
}: {
  question: string
  onSubmit: (answer: string) => Promise<boolean>
  onClose: () => void
}) {
  const { t } = useI18n()
  const ref = useRef<HTMLDialogElement>(null)
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // showModal gives focus trapping, Esc to close and an inert page behind
  useEffect(() => {
    ref.current?.showModal()
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!answer.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      if (await onSubmit(answer)) return
      setError(t.wrongAnswer)
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={ref}
      className="map-lock"
      aria-labelledby="map-lock-title"
      onCancel={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <form onSubmit={submit}>
        <h2 id="map-lock-title">
          <LockIcon /> {t.mapLockTitle}
        </h2>
        <p className="map-lock-hint">{t.mapLockHint}</p>
        <label>
          <span>{question}</span>
          <input
            autoFocus
            value={answer}
            onChange={(e) => {
              setAnswer(e.target.value)
              setError(null)
            }}
            placeholder={t.mapAnswer}
            autoComplete="off"
            aria-invalid={!!error}
            aria-describedby={error ? 'map-lock-error' : undefined}
          />
        </label>
        <p id="map-lock-error" className="map-lock-error" role="alert">
          {error}
        </p>
        <div className="map-lock-actions">
          <button type="button" onClick={onClose}>
            {t.cancel}
          </button>
          <button type="submit" className="primary" disabled={busy || !answer.trim()}>
            {busy ? t.unlocking : t.unlock}
          </button>
        </div>
      </form>
    </dialog>
  )
}

export function LockIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}
