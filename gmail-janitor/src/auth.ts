// gmail.modify can read mail and move it to Trash, but cannot permanently delete.
// Permanent delete (empty Trash) would need https://mail.google.com/ - add later as an opt-in.
const SCOPE = "https://www.googleapis.com/auth/gmail.modify";

export type Profile = { emailAddress: string; messagesTotal: number };

/** Opens Google's consent popup and resolves with a short-lived (about 1 hour) access token. */
export function requestToken(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof google === "undefined") {
      reject(
        new Error(
          "Google sign-in did not load. Check your connection and refresh.",
        ),
      );
      return;
    }
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (r) =>
        r.error
          ? reject(new Error(r.error_description ?? r.error))
          : resolve(r.access_token),
      error_callback: (e) => reject(new Error(e.message ?? e.type)),
    });
    client.requestAccessToken();
  });
}

export async function getProfile(token: string): Promise<Profile> {
  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok)
    throw new Error(
      `Gmail API returned ${res.status}. Is the Gmail API enabled for your project?`,
    );
  return res.json();
}
