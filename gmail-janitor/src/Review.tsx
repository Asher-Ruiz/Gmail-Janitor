import { useMemo, useState } from 'react'
import type { Sender } from './scan'

type Props = {
  senders: Sender[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
  includeRead: boolean
  onClean: () => void
  onRescan: () => void
}

export default function Review({ senders, selected, onChange, includeRead, onClean, onRescan }: Props) {
  const [filter, setFilter] = useState('All')

  const categories = useMemo(() => {
    const totals = new Map<string, number>()
    for (const s of senders) totals.set(s.category, (totals.get(s.category) ?? 0) + s.count)
    return [...totals.entries()].sort((a, b) => b[1] - a[1])
  }, [senders])

  const visible = filter === 'All' ? senders : senders.filter((s) => s.category === filter)
  const allChecked = visible.length > 0 && visible.every((s) => selected.has(s.address))
  const picked = senders.filter((s) => selected.has(s.address))
  const pickedMessages = picked.reduce((sum, s) => sum + s.count, 0)

  const toggle = (address: string) => {
    const next = new Set(selected)
    if (next.has(address)) next.delete(address)
    else next.add(address)
    onChange(next)
  }
  const toggleVisible = () => {
    const next = new Set(selected)
    for (const s of visible) {
      if (allChecked) next.delete(s.address)
      else next.add(s.address)
    }
    onChange(next)
  }

  if (senders.length === 0) {
    return (
      <>
        <h1>No senders found</h1>
        <p className="lead">The scan found no messages to group. Try “All mail” or a larger batch.</p>
        <div className="actions">
          <button className="btn" onClick={onRescan}>Scan again</button>
        </div>
      </>
    )
  }

  return (
    <>
      <h1>Choose what to remove</h1>
      <div className="filters" role="group" aria-label="Category">
        {[['All', senders.reduce((t, s) => t + s.count, 0)] as const, ...categories].map(([name, total]) => (
          <button
            key={name}
            aria-pressed={filter === name}
            className={filter === name ? 'filter on' : 'filter'}
            onClick={() => setFilter(name)}
          >
            {name} ({total.toLocaleString()})
          </button>
        ))}
      </div>

      <label className="sender all">
        <input type="checkbox" checked={allChecked} onChange={toggleVisible} />
        <span>Select all {visible.length.toLocaleString()} senders shown</span>
      </label>

      <ul className="senders">
        {visible.map((s) => (
          <li key={s.address}>
            <label className="sender">
              <input type="checkbox" checked={selected.has(s.address)} onChange={() => toggle(s.address)} />
              <span className="who">
                <b>{s.name || s.address}</b>
                {s.name && <small>{s.address}</small>}
              </span>
              <span className="n">{s.count.toLocaleString()}</span>
            </label>
          </li>
        ))}
      </ul>

      <p className="hint">
        Cleaning moves {includeRead ? 'all' : 'only unread'} mail from the senders you check. Starred mail is never moved.
      </p>

      <div className="bar">
        <span aria-live="polite">
          {picked.length === 0
            ? 'Check at least one sender to continue.'
            : `${picked.length.toLocaleString()} senders selected, ${pickedMessages.toLocaleString()} messages`}
        </span>
        <div className="actions">
          <button className="btn quiet" onClick={onRescan}>Scan again</button>
          <button className="btn danger" disabled={picked.length === 0} onClick={onClean}>Move to Trash</button>
        </div>
      </div>
    </>
  )
}
