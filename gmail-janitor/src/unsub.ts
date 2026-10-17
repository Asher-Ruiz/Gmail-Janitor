import type { Sender } from './scan'

// Green: Gmail verified the sender, the link matches it, and it supports one-click (RFC 8058). We can
// send the request. Otherwise a sender may still offer a "fix" the person can choose to use after reading the
// warnings: "post" sends the one-click request anyway, "page" opens their unsubscribe page. Senders with no
// usable, structurally safe link get no fix at all, so nothing can be aimed at an unsafe address.
export type Fix = { kind: 'post' | 'page'; url: string; host: string }
export type Verdict = { ok: true; url: string; host: string } | { ok: false; reasons: string[]; fix?: Fix }

const MIN_MESSAGES = 2
// Shared email-sending platforms whose links legitimately differ from the brand's own domain.
const SENDING_PLATFORMS = new Set([
  'sendgrid.net', 'list-manage.com', 'mailchimp.com', 'mcsv.net', 'constantcontact.com', 'klaviyo.com',
  'klaviyomail.com', 'mailgun.org', 'mailgun.net', 'hubspotemail.net', 'hubspot.com', 'exacttarget.com',
  'iterable.com', 'braze.com', 'createsend.com', 'cmail19.com', 'cmail20.com', 'brevo.com', 'sendinblue.com',
  'mailjet.com', 'sparkpostmail.com', 'postmarkapp.com', 'customer.io',
])
const TWO_PART = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu'])

/** Rough "registered domain": last two labels, or three for names like example.co.uk. */
function baseDomain(host: string) {
  const p = host.toLowerCase().split('.')
  if (p.length >= 3 && p[p.length - 1].length === 2 && TWO_PART.has(p[p.length - 2])) return p.slice(-3).join('.')
  return p.slice(-2).join('.')
}

/** Strict link rules: https only, a real website name, nothing that could point inside a home network. */
function parseHttps(raw: string): URL | string {
  let u: URL
  try { u = new URL(raw) } catch { return 'Their unsubscribe link is malformed' }
  const h = u.hostname.toLowerCase()
  if (raw.length > 2000 || u.protocol !== 'https:') return 'Their unsubscribe link is not a secure web address'
  if (u.username || u.password || u.port) return 'Their unsubscribe link has unusual parts'
  if (!h.includes('.') || h.includes(':') || /^\d+(\.\d+){3}$/.test(h) || /\.(local|internal|lan|localhost|home|corp)$/.test(h)) {
    return 'Their unsubscribe link points at an address, not a website name'
  }
  if (h.includes('xn--')) return 'Their unsubscribe link uses look-alike characters'
  return u
}

export function assess(s: Sender): Verdict {
  const no = (reasons: string[], fix?: Fix): Verdict => ({ ok: false, reasons, fix })
  // Hard stops: with no usable, safe-looking link there is nothing to offer, even as an override.
  if (!s.unsubHeader) return no(['No unsubscribe option in their emails'])
  const raw = [...s.unsubHeader.matchAll(/<([^>]+)>/g)].map((m) => m[1].trim()).find((u) => /^https:/i.test(u))
  if (!raw) return no(['Only offers an email-address method, which we can’t send for you yet'])
  const url = parseHttps(raw)
  if (typeof url === 'string') return no([url])

  // Soft concerns: the person may still go ahead after reading them.
  const concerns: string[] = []
  const senderDomain = s.address.split('@')[1] ?? ''
  if (s.count < MIN_MESSAGES) concerns.push('Too few emails to be sure this sender is genuine')
  // Gmail writes its own result as the first Authentication-Results header; later copies could have been
  // added by the sender, so only a first header from Gmail's own server counts.
  const verifiedFrom = s.auth.match(/header\.from=([^\s;)]+)/i)?.[1]
  if (!/^mx\.google\.com/i.test(s.auth.trim()) || !/dmarc=pass/i.test(s.auth)) {
    concerns.push('Gmail could not verify who really sent these emails')
  } else if (!verifiedFrom || baseDomain(verifiedFrom) !== baseDomain(senderDomain)) {
    concerns.push('The verified sender does not match the name on the emails')
  }
  const base = baseDomain(url.hostname)
  if (base !== baseDomain(senderDomain) && !SENDING_PLATFORMS.has(base)) {
    concerns.push('Their unsubscribe link goes to a website that does not match the sender')
  }

  const oneClick = /list-unsubscribe=one-click/i.test(s.unsubPost)
  const host = url.hostname.toLowerCase()
  if (oneClick && concerns.length === 0) return { ok: true, url: url.toString(), host }
  if (!oneClick) concerns.push('Needs a manual step: you would finish on their website')
  return no(concerns, { kind: oneClick ? 'post' : 'page', url: url.toString(), host })
}

/** True when there is anything to show the person for this sender (a safe request or an override). */
export function offers(s: Sender) {
  const v = assess(s)
  return v.ok || Boolean(v.fix)
}

/** Account and security senders where unsubscribing could stop notices the person wants. */
export const caution = (address: string) =>
  /^(no-?reply|do-?not-?reply|billing|security|receipts?|alerts?|notifications?|accounts?|orders?|support|verify|payments?|invoice)/i.test(
    address.split('@')[0],
  )

export function rateText(count: number, windowDays: number) {
  if (windowDays < 14) return `${count} emails in the last ${Math.max(1, Math.round(windowDays))} days`
  return `about ${Math.max(1, Math.round((count / windowDays) * 30))} a month`
}

/**
 * Sends the standard one-click request: a POST with the body "List-Unsubscribe=One-Click". No cookies,
 * no referrer. The browser must follow redirects for this kind of request, and it hides the reply, so true
 * means "sent", not "worked".
 */
export async function sendUnsubscribe(url: string): Promise<boolean> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 10000)
  try {
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      body: new URLSearchParams({ 'List-Unsubscribe': 'One-Click' }),
      signal: ctl.signal,
    })
    return true
  } catch (err) {
    // Log only the website (the full link identifies the user to the sender).
    console.warn('Unsubscribe request failed for', new URL(url).host, err)
    return false
  } finally {
    clearTimeout(timer)
  }
}

const KEY = 'gmail-janitor-unsub'
export function loadRequested(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { return {} }
}
export function saveRequested(address: string) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...loadRequested(), [address]: Date.now() })) } catch { /* storage blocked: fine */ }
}
