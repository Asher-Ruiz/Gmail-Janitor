const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
const CONCURRENCY = 4 // conservative: Gmail throttles bursts and limits concurrent requests per user

const CATEGORIES: Record<string, string> = {
  CATEGORY_PROMOTIONS: 'Promotions',
  CATEGORY_SOCIAL: 'Social',
  CATEGORY_UPDATES: 'Updates',
  CATEGORY_FORUMS: 'Forums',
  CATEGORY_PERSONAL: 'Personal',
}

export const SLOWDOWN_NOTE = 'Google asked us to slow down, so we’re pausing and going a little slower. This is normal.'
let throttleListener: ((ms: number) => void) | null = null
/** Lets the UI find out when Gmail throttles us (pass null to stop listening). */
export const onThrottle = (fn: ((ms: number) => void) | null) => { throttleListener = fn }

// --- Adaptive pacing ---------------------------------------------------------
// All requests share one speed limit. When Gmail throttles, the limit drops sharply and everything
// pauses. The app then holds slow for a quiet window, climbs back up gradually, and after a long calm
// stretch raises its ceiling to test whether Gmail will allow more. That gives a fast / slow / fast
// cycle with long gaps between throttles. Tune the numbers below if throttling is too frequent.
const START_RATE = 6 // requests per second
const MAX_RATE = 10
const MIN_RATE = 1.5
const HOLD_MS = 10000 // stay slow this long after a throttle before climbing again
const PROBE_MS = 30000 // after this long without a throttle, test a ceiling 1/sec higher
const pacer = { rate: START_RATE, ceiling: MAX_RATE, nextSlot: 0, pausedUntil: 0, streak: 0, lastCut: 0, lastProbe: 0 }

async function paced() {
  const now = Date.now()
  const start = Math.max(now, pacer.nextSlot, pacer.pausedUntil)
  pacer.nextSlot = start + 1000 / pacer.rate
  if (start > now) await sleep(start - now)
}

function speedUp() {
  const now = Date.now()
  if (now - pacer.lastCut < HOLD_MS) return // give Google a quiet window first
  if (now - pacer.lastProbe > PROBE_MS && pacer.ceiling < MAX_RATE) {
    pacer.ceiling = Math.min(MAX_RATE, pacer.ceiling + 1) // calm for a while: test a higher limit
    pacer.lastProbe = now
  }
  if (++pacer.streak >= 20 && pacer.rate < pacer.ceiling) {
    pacer.rate = Math.min(pacer.ceiling, pacer.rate + 0.5)
    pacer.streak = 0
  }
}

function slowDown(waitMs: number) {
  const now = Date.now()
  pacer.pausedUntil = Math.max(pacer.pausedUntil, now + waitMs) // pause everyone, not just this request
  if (now - pacer.lastCut > 5000) {
    // Several in-flight requests usually fail together, so count them as one event.
    pacer.lastCut = now
    pacer.lastProbe = now
    pacer.ceiling = Math.max(MIN_RATE, pacer.rate * 0.85) // the limit is roughly here...
    pacer.rate = Math.max(MIN_RATE, pacer.rate / 2) // ...so drop well below it
    pacer.streak = 0
  }
}

export type Sender = {
  address: string
  name: string
  category: string
  count: number
  first: number // oldest and newest message times (ms) seen in the scan
  last: number
  cats: Record<string, number> // tally used to pick the most common category
  unsubHeader: string // headers from this sender's newest message
  unsubPost: string
  auth: string
}
export class SessionExpiredError extends Error {}

// Session handling: requests always use the newest token. If Google reports the sign-in has ended (401),
// every request waits on ONE shared renewal that the app fulfils when the person signs in again, then
// carries on, so a long scan or cleanup resumes instead of failing.
let currentToken = ''
let renewal: Promise<string> | null = null
let requestRenewal: (() => Promise<string>) | null = null
export const setSessionToken = (t: string) => { currentToken = t }
export const onSessionExpired = (fn: (() => Promise<string>) | null) => { requestRenewal = fn }

type Msg = { labelIds?: string[]; internalDate?: string; payload: { headers: { name: string; value: string }[] } }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const backoff = (attempt: number) => Math.min(30000, 1000 * 2 ** attempt) + Math.random() * 500

async function errorReason(res: Response): Promise<string> {
  try {
    const body = await res.json()
    return `${body.error?.errors?.[0]?.reason ?? ''} ${body.error?.message ?? ''}`.trim() || 'unknown reason'
  } catch {
    return 'unknown reason'
  }
}

export async function api<T>(token: string, path: string, init?: { method: 'POST'; body: unknown }): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await paced()
    const used = currentToken || token
    let res: Response
    try {
      res = await fetch(`${API}${path}`, {
        method: init?.method ?? 'GET',
        headers: { Authorization: `Bearer ${used}`, ...(init ? { 'Content-Type': 'application/json' } : {}) },
        body: init ? JSON.stringify(init.body) : undefined,
      })
    } catch {
      // The request never reached Google (dropped wifi, etc.): wait and try again.
      if (attempt >= 6) throw new Error('Lost connection to Google. Check your internet and scan again.')
      await sleep(backoff(attempt))
      continue
    }
    if (res.ok) {
      speedUp()
      const text = await res.text() // some Gmail calls (batchModify) return an empty body
      return (text ? JSON.parse(text) : undefined) as T
    }
    if (res.status === 401) {
      if (currentToken && currentToken !== used) continue // a fresh token arrived while this request was in flight
      if (!requestRenewal) throw new SessionExpiredError('Your Google session expired. Sign in again to continue.')
      renewal ??= requestRenewal().finally(() => { renewal = null })
      currentToken = await renewal // throws if the person cancels instead of signing in
      continue
    }

    const reason = await errorReason(res)
    const rateLimited = res.status === 429 || (res.status === 403 && /rate|quota|concurrent/i.test(reason))
    if (!(rateLimited || res.status >= 500) || attempt >= 7) {
      throw new Error(`Gmail returned ${res.status}: ${reason}`)
    }
    const retryAfter = Number(res.headers.get('Retry-After')) * 1000
    const wait = retryAfter || backoff(attempt)
    if (rateLimited) {
      slowDown(wait)
      throttleListener?.(wait)
    }
    await sleep(wait)
  }
}

async function listScanIds(
  token: string,
  q: string,
  limit: number,
  signal: AbortSignal,
  onFound: (n: number) => void,
): Promise<string[]> {
  const ids: string[] = []
  let pageToken = ''
  do {
    if (signal.aborted) throw new DOMException('Scan cancelled', 'AbortError')
    const params = new URLSearchParams({ q, maxResults: '500' })
    if (pageToken) params.set('pageToken', pageToken)
    const page = await api<{ messages?: { id: string }[]; nextPageToken?: string }>(token, `/messages?${params}`)
    ids.push(...(page.messages ?? []).map((m) => m.id))
    onFound(ids.length)
    pageToken = page.nextPageToken ?? ''
  } while (pageToken && (limit === 0 || ids.length < limit))
  return limit ? ids.slice(0, limit) : ids
}

function parseFrom(from: string) {
  const angle = from.match(/<([^>]+)>/)
  const address = (angle ? angle[1] : from).trim().toLowerCase()
  const name = angle ? from.slice(0, angle.index).replace(/"/g, '').trim() : ''
  return { address, name }
}

/** Reads only a few headers (sender, unsubscribe info, Gmail's verification result), labels, and the date. Never the body or a preview. */
export async function scanInbox(
  token: string,
  limit: number, // 0 = no limit
  unreadOnly: boolean,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
  onFound: (n: number) => void = () => {},
): Promise<Sender[]> {
  // "All mail" skips Sent and Drafts, since grouping those by sender would just list the user.
  const q = unreadOnly ? 'is:unread -in:trash -in:spam' : '-in:trash -in:spam -in:sent -in:drafts'
  const ids = await listScanIds(token, q, limit, signal, onFound)
  onProgress(0, ids.length)
  const senders = new Map<string, Sender>()
  let next = 0
  let done = 0
  let stopped = false

  const worker = async () => {
    try {
      while (next < ids.length && !stopped) {
        if (signal.aborted) throw new DOMException('Scan cancelled', 'AbortError')
        const id = ids[next++]
        const msg = await api<Msg>(
          token,
          `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=List-Unsubscribe` +
            '&metadataHeaders=List-Unsubscribe-Post&metadataHeaders=Authentication-Results' +
            '&fields=labelIds,internalDate,payload/headers', // asking only for these keeps the text preview out
        )
        const headers = new Map(msg.payload.headers.map((h) => [h.name.toLowerCase(), h.value]))
        const { address, name } = parseFrom(headers.get('from') ?? '')
        if (address) {
          const tab = (msg.labelIds ?? []).find((l) => l in CATEGORIES)
          const category = tab ? CATEGORIES[tab] : headers.has('list-unsubscribe') ? 'Newsletters' : 'Other'
          const when = Number(msg.internalDate) || 0
          let sender = senders.get(address)
          if (!sender) {
            sender = { address, name, category, count: 0, first: when, last: when, cats: {}, unsubHeader: '', unsubPost: '', auth: '' }
            senders.set(address, sender)
          }
          sender.count++
          sender.cats[category] = (sender.cats[category] ?? 0) + 1
          sender.first = Math.min(sender.first, when)
          if (when >= sender.last) {
            sender.last = when
            sender.unsubHeader = headers.get('list-unsubscribe') ?? ''
            sender.unsubPost = headers.get('list-unsubscribe-post') ?? ''
            sender.auth = msg.payload.headers.find((h) => h.name.toLowerCase() === 'authentication-results')?.value ?? ''
          }
        }
        onProgress(++done, ids.length)
      }
    } catch (e) {
      stopped = true // tell the other workers to stop sending requests
      throw e
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  return [...senders.values()]
    .map((s) => ({ ...s, category: Object.entries(s.cats).sort((a, b) => b[1] - a[1])[0][0] }))
    .sort((a, b) => b.count - a.count)
}

/** Gmail's own count of unread messages (approximate, includes every folder). */
export async function getUnreadTotal(token: string): Promise<number> {
  const label = await api<{ messagesUnread: number }>(token, '/labels/UNREAD')
  return label.messagesUnread
}
