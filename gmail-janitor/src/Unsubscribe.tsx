import { useMemo, useState, type ReactNode } from 'react'
import type { Sender } from './scan'
import Progress from './Progress'
import { assess, caution, loadRequested, rateText, saveRequested, sendUnsubscribe } from './unsub'

const clock = () => Date.now() // read inside event handlers only, never during render

type Props = { senders: Sender[]; allSenders: Sender[]; onDone: () => void }

function Who({ s, children }: { s: Sender; children?: ReactNode }) {
  return (
    <span className="who wrap">
      <b>{s.name || s.address}</b>
      <small>{s.address}</small>
      {children}
    </span>
  )
}

export default function Unsubscribe({ senders, allSenders, onDone }: Props) {
  const [phase, setPhase] = useState<'choose' | 'sending' | 'done'>('choose')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [ack, setAck] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [startedAt, setStartedAt] = useState(0)
  const [results, setResults] = useState({ sent: 0, failed: 0 })
  const requested = useMemo(() => loadRequested(), [])

  // How long the scan covered, so "emails per month" is an honest estimate.
  const windowDays = useMemo(() => {
    const first = allSenders.reduce((m, s) => (s.first ? Math.min(m, s.first) : m), Infinity)
    const last = allSenders.reduce((m, s) => Math.max(m, s.last), 0)
    return Number.isFinite(first) ? (last - first) / 86400000 : 0
  }, [allSenders])

  const rows = senders.map((s) => ({ s, v: assess(s) }))
  // Safe to send: Gmail verified them and their link checks out.
  const eligible = rows.flatMap(({ s, v }) => (v.ok ? [{ s, url: v.url, host: v.host }] : []))
  // Unverified, but the person may still send the one-click request after reading the warnings.
  const risky = rows.flatMap(({ s, v }) =>
    !v.ok && v.fix?.kind === 'post' ? [{ s, url: v.fix.url, host: v.fix.host, reasons: v.reasons }] : [])
  // No one-click support: the person can open their unsubscribe page and finish there.
  const pages = rows.flatMap(({ s, v }) =>
    !v.ok && v.fix?.kind === 'page' ? [{ s, fix: v.fix, reasons: v.reasons }] : [])
  // No usable link at all.
  const blocked = rows.flatMap(({ s, v }) => (!v.ok && !v.fix ? [{ s, reasons: v.reasons }] : []))

  const allPicked = eligible.length > 0 && eligible.every(({ s }) => picked.has(s.address))
  const riskyPicked = risky.filter(({ s }) => picked.has(s.address)).length
  const extra = risky.length + pages.length + blocked.length

  const toggle = (address: string) => {
    const next = new Set(picked)
    if (next.has(address)) next.delete(address)
    else next.add(address)
    setPicked(next)
  }
  const toggleSafe = () => {
    const next = new Set(picked)
    for (const { s } of eligible) {
      if (allPicked) next.delete(s.address)
      else next.add(s.address)
    }
    setPicked(next)
  }

  const send = async () => {
    const chosen = [...eligible, ...risky].filter(({ s }) => picked.has(s.address))
    setPhase('sending')
    setStartedAt(clock())
    setProgress({ done: 0, total: chosen.length })
    let sent = 0
    let failed = 0
    for (const { s, url } of chosen) {
      if (await sendUnsubscribe(url)) {
        sent++
        saveRequested(s.address)
      } else {
        failed++
      }
      setProgress({ done: sent + failed, total: chosen.length })
      await new Promise((r) => setTimeout(r, 400)) // be polite: one request at a time
    }
    setResults({ sent, failed })
    setPhase('done')
  }

  if (phase === 'sending') {
    return (
      <div>
        <h1>Sending requests</h1>
        <Progress done={progress.done} total={progress.total} startedAt={startedAt} verb="Sent" noun="requests" />
      </div>
    )
  }

  if (phase === 'done') {
    return (
      <div>
        <h1>{results.sent.toLocaleString()} {results.sent === 1 ? 'request' : 'requests'} sent</h1>
        <p className="lead">
          We can’t see each sender’s reply, so we can’t promise it worked. Most senders stop within a couple of days.
          If one keeps emailing you after about two weeks, scan again and clear them out, or use the unsubscribe link
          inside one of their emails.
        </p>
        {results.failed > 0 && (
          <p className="hint">
            {results.failed} could not be reached, so nothing was sent to them.
            {results.sent === 0 &&
              ' Your browser blocked these requests. An ad blocker or privacy setting is a common cause. Try again in a private window.'}
          </p>
        )}
        <button className="btn" onClick={onDone}>Finish</button>
      </div>
    )
  }

  return (
    <>
      <h1>Stop these senders from coming back?</h1>
      <p className="meta">
        {senders.length.toLocaleString()} senders cleared.{' '}
        {eligible.length > 0 ? `${eligible.length.toLocaleString()} can be unsubscribed safely.` : 'None could be verified.'}
      </p>

      {eligible.length > 0 && (
        <>
          <label className="sender all">
            <input type="checkbox" checked={allPicked} onChange={toggleSafe} />
            <span>Select all {eligible.length.toLocaleString()}</span>
          </label>
          <ul className="senders">
            {eligible.map(({ s, host }) => (
              <li key={s.address}>
                <label className="sender">
                  <input type="checkbox" checked={picked.has(s.address)} onChange={() => toggle(s.address)} />
                  <Who s={s}>
                    <small>{rateText(s.count, windowDays)}. Request goes to {host}</small>
                    {requested[s.address] && (
                      <small>You already asked on {new Date(requested[s.address]).toLocaleDateString()}</small>
                    )}
                    {caution(s.address) && (
                      <small className="warn">
                        This looks like an account or security sender. Unsubscribing could stop notices you want.
                      </small>
                    )}
                  </Who>
                  <span className="tag">{s.category}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="hint">
        How this works: your browser sends a short request straight to each sender’s website. We can’t see their
        reply, so we’ll say “sent,” not “done.” They will see your internet address, just as if you clicked the link
        in their email.
      </p>

      {extra > 0 && (
        <details className="skipped">
          <summary>{extra.toLocaleString()} senders we couldn’t verify or can’t unsubscribe from</summary>

          {(risky.length > 0 || pages.length > 0) && (
            <p className="warn-box">
              Be careful: scam emails often include unsubscribe links too, and unsubscribing from a scammer can
              confirm your address is real. Only continue for senders you recognize.
            </p>
          )}

          {risky.length > 0 && (
            <>
              <p className="sub">Unsubscribe anyway ({risky.length.toLocaleString()})</p>
              <ul className="senders">
                {risky.map(({ s, host, reasons }) => (
                  <li key={s.address}>
                    <label className="sender">
                      <input type="checkbox" checked={picked.has(s.address)} onChange={() => toggle(s.address)} />
                      <Who s={s}>
                        {reasons.map((r) => <small key={r} className="warn">{r}</small>)}
                        <small>Request would go to {host}</small>
                      </Who>
                      <span className="tag">{s.category}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}

          {pages.length > 0 && (
            <>
              <p className="sub">Finish these on their own website ({pages.length.toLocaleString()})</p>
              <ul className="senders">
                {pages.map(({ s, fix, reasons }) => (
                  <li key={s.address}>
                    <div className="sender">
                      <Who s={s}>
                        {reasons.map((r) => <small key={r} className="warn">{r}</small>)}
                        <small>Opens {fix.host} in a new tab</small>
                      </Who>
                      <a className="btn ghost" href={fix.url} target="_blank" rel="noopener noreferrer">Open page</a>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {blocked.length > 0 && (
            <>
              <p className="sub">No safe option ({blocked.length.toLocaleString()})</p>
              <ul className="top">
                {blocked.map(({ s, reasons }) => (
                  <li key={s.address}>
                    <span>{s.address}</span>
                    <small>{reasons.join('. ')}</small>
                  </li>
                ))}
              </ul>
            </>
          )}
        </details>
      )}

      {riskyPicked > 0 && (
        <label className="opt">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span>
            I understand that {riskyPicked.toLocaleString()} of these senders could not be verified. Some may be
            scams, and unsubscribing can confirm my address is real.
          </span>
        </label>
      )}

      <div className="actions">
        <button className="btn ghost" onClick={onDone}>Skip</button>
        <button className="btn" disabled={picked.size === 0 || (riskyPicked > 0 && !ack)} onClick={send}>
          Send {picked.size.toLocaleString()} {picked.size === 1 ? 'request' : 'requests'}
        </button>
      </div>
    </>
  )
}
