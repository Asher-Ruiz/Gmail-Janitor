import { useEffect, useState } from 'react'

type Props = { expiresAt: number; waiting: boolean; busy: boolean; error: string; onRenew: () => void }

/** Warns shortly before Google's sign-in ends, and offers a one-click way to stay signed in. */
export default function SessionBar({ expiresAt, waiting, busy, error, onRenew }: Props) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const left = expiresAt - now
  const ended = waiting || left <= 0
  if (!ended && left > 10 * 60 * 1000) return null
  const minutes = Math.max(1, Math.ceil(left / 60000))

  return (
    <div className={ended || left <= 3 * 60 * 1000 ? 'sessionbar urgent' : 'sessionbar'} role="status">
      <p>
        {waiting
          ? 'Your Google sign-in ended, so your work is paused. Sign in to pick up right where you left off.'
          : ended
            ? 'Your Google sign-in has ended. Sign in again to keep going.'
            : `Your Google sign-in ends in about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}. Stay signed in so nothing gets interrupted.`}
        {error && <span className="error"> {error}</span>}
      </p>
      <button className="btn" onClick={onRenew} disabled={busy}>
        {busy ? 'Waiting for Google…' : ended ? 'Sign in again' : 'Stay signed in'}
      </button>
    </div>
  )
}
