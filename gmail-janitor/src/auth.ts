// gmail.modify can read mail and move it to Trash, but cannot permanently delete.
// Permanent delete (empty Trash) would need https://mail.google.com/ - add later as an opt-in.
const SCOPE = 'https://www.googleapis.com/auth/gmail.modify'

export type Profile = { emailAddress: string; messagesTotal: number }
export type Session = { token: string; expiresAt: number } // expiresAt is a ms timestamp

type Options = { renew?: boolean; hint?: string }

/**
 * Opens Google's sign-in popup and resolves with a short-lived (about 1 hour) access token and its expiry time.
 * For a renewal, `prompt: ''` skips the consent screen when the person already approved, so the popup is brief.
 */
export function requestToken(clientId: string, opts: Options = {}): Promise<Session> {
  return new Promise((resolve, reject) => {
    if (typeof google === 'undefined') {
      reject(new Error('Google sign-in did not load. Check your connection and refresh.'))
      return
    }
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (r) =>
        r.error
          ? reject(new Error(r.error_description ?? r.error))
          : resolve({
              token: r.access_token,
              expiresAt: Date.now() + (Number(r.expires_in) || 3600) * 1000,
            }),
      error_callback: (e) => reject(new Error(e.message ?? e.type)),
    })
    client.requestAccessToken(opts.renew ? { prompt: '', ...(opts.hint ? { hint: opts.hint } : {}) } : {})
  })
}

export async function getProfile(token: string): Promise<Profile> {
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Gmail API returned ${res.status}. Is the Gmail API enabled for your project?`)
  return res.json()
}
