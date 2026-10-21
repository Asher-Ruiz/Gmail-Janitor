import { useState } from 'react'
import ScopeToggle, { type Scope } from './ScopeToggle'

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const yearsAgo = (n: number) => {
  const d = new Date()
  d.setFullYear(d.getFullYear() - n)
  return iso(d)
}
const daysAgo = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return iso(d)
}

type Props = { scope: Scope; onScope: (s: Scope) => void; onPrepare: (date: string) => void; disabled: boolean }

export default function DateClean({ scope, onScope, onPrepare, disabled }: Props) {
  const [date, setDate] = useState('')
  const isRecent = date !== '' && date > daysAgo(90)

  return (
    <section className="card secondary">
      <div className="card-head">
        <h2 className="title">Clear Mail by Date</h2>
        <ScopeToggle value={scope} onChange={onScope} disabled={disabled} />
      </div>
      <div className="quick">
        {[1, 2, 5].map((n) => (
          <button key={n} className="filter" disabled={disabled} onClick={() => setDate(yearsAgo(n))}>
            {n} {n === 1 ? 'year' : 'years'} ago
          </button>
        ))}
      </div>
      <label className="pick">
        Everything before{' '}
        <input type="date" value={date} max={iso(new Date())} disabled={disabled} onChange={(e) => setDate(e.target.value)} />
      </label>
      {isRecent && <p className="hint">That date is fairly recent, so this would include mail from the last few months.</p>}
      <button className="btn neutral" disabled={disabled || !date} onClick={() => onPrepare(date)}>Count these emails</button>
      {(disabled || !date) && (
        <p className="hint">{disabled ? 'Available when the scan finishes.' : 'Pick a date to continue.'}</p>
      )}
    </section>
  )
}
