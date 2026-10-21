import { useState } from 'react'
import type { Plan } from './cleanup'
import Progress from './Progress'
import { SLOWDOWN_NOTE } from './scan'

export type Stage = 'review' | 'planning' | 'confirm' | 'working' | 'unsub' | 'done'

type Props = {
  mode: 'senders' | 'date'
  dateLabel: string
  stage: Exclude<Stage, 'review' | 'unsub'>
  plan: Plan | null
  work: { done: number; total: number }
  moved: number
  startedAt: number
  slowdown: boolean
  unreadTotal: number | null
  includeRead: boolean
  onConfirm: () => void
  onBack: () => void
  onCancel: () => void
  onFinish: () => void
}

/** Date cleanups touch a lot of mail, so the red button stays locked until the person ticks a box. */
function DateConfirm({ total, dateLabel, includeRead, onConfirm, onBack }: {
  total: number
  dateLabel: string
  includeRead: boolean
  onConfirm: () => void
  onBack: () => void
}) {
  const [sure, setSure] = useState(false)
  return (
    <div>
      <h1>Move {total.toLocaleString()} emails to Trash?</h1>
      <p className="lead">
        These are all the {includeRead ? '' : 'unread '}emails you received before {dateLabel}. Starred and important emails, drafts, and emails
        you sent are left alone. You can restore anything from Trash for 30 days.
      </p>
      <label className="opt sure">
        <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
        <span>I understand that {total.toLocaleString()} emails will move to Trash.</span>
      </label>
      <div className="actions">
        <button className="btn ghost" onClick={onBack}>Go back</button>
        <button className="btn danger" disabled={!sure} onClick={onConfirm}>
          Move {total.toLocaleString()} to Trash
        </button>
      </div>
    </div>
  )
}

export default function Clean({
  mode, dateLabel, stage, plan, work, moved, startedAt, slowdown, unreadTotal, includeRead,
  onConfirm, onBack, onCancel, onFinish,
}: Props) {
  const note = slowdown ? SLOWDOWN_NOTE : undefined

  if (stage === 'planning') {
    return (
      <div>
        <h1>Counting what would move</h1>
        {mode === 'date' ? (
          <p className="hint">Found {work.done.toLocaleString()} emails so far…</p>
        ) : (
          <Progress done={work.done} total={work.total} startedAt={startedAt} verb="Checked" noun="senders" note={note} />
        )}
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    )
  }

  if (stage === 'confirm' && plan) {
    const total = plan.ids.length
    if (total === 0) {
      return (
        <div>
          <h1>Nothing to move</h1>
          <p className="lead">
            {mode === 'date'
              ? `There are no ${includeRead ? '' : 'unread '}emails from before ${dateLabel} that aren’t starred or important.`
              : `None of the selected senders have ${includeRead ? '' : 'unread '}mail that isn’t starred.`}
          </p>
          <button className="btn" onClick={onBack}>Go back</button>
        </div>
      )
    }
    if (mode === 'date') {
      return <DateConfirm total={total} dateLabel={dateLabel} includeRead={includeRead} onConfirm={onConfirm} onBack={onBack} />
    }
    return (
      <div>
        <h1>Move {total.toLocaleString()} messages to Trash?</h1>
        <p className="lead">
          This covers {includeRead ? 'read and unread' : 'unread'} mail from {plan.perSender.length.toLocaleString()} senders,
          across your whole mailbox. Starred messages are left alone. You can restore anything from Trash for 30 days.
        </p>
        <ul className="top">
          {plan.perSender.slice(0, 5).map(([address, n]) => (
            <li key={address}><span>{address}</span><b>{n.toLocaleString()}</b></li>
          ))}
          {plan.perSender.length > 5 && <li className="more">and {plan.perSender.length - 5} more senders</li>}
        </ul>
        <div className="actions">
          <button className="btn ghost" onClick={onBack}>Go back</button>
          <button className="btn danger" onClick={onConfirm}>Move {total.toLocaleString()} to Trash</button>
        </div>
      </div>
    )
  }

  if (stage === 'working') {
    return (
      <div>
        <h1>Moving mail to Trash</h1>
        <Progress done={work.done} total={work.total} startedAt={startedAt} verb="Moved" noun="messages" note={note} />
        <button className="btn ghost" onClick={onCancel}>Stop</button>
      </div>
    )
  }

  return (
    <div>
      <h1>Moved {moved.toLocaleString()} messages to Trash</h1>
      <p className="lead">Open Trash in Gmail to review or restore them. Gmail empties Trash on its own after 30 days.</p>
      {unreadTotal !== null && (
        <p className="lead">About {unreadTotal.toLocaleString()} unread messages are left in your mailbox.</p>
      )}
      <button className="btn" onClick={onFinish}>{mode === 'date' ? 'Back to start' : 'Scan the next batch'}</button>
    </div>
  )
}
