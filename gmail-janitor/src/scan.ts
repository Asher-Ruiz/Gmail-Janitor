const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const CONCURRENCY = 4; // conservative: Gmail throttles bursts and limits concurrent requests per user

const CATEGORIES: Record<string, string> = {
  CATEGORY_PROMOTIONS: "Promotions",
  CATEGORY_SOCIAL: "Social",
  CATEGORY_UPDATES: "Updates",
  CATEGORY_FORUMS: "Forums",
  CATEGORY_PERSONAL: "Personal",
};

export const SLOWDOWN_NOTE =
  "Google asked us to slow down, so we’re pausing briefly. This is normal.";
let throttleListener: ((ms: number) => void) | null = null;
/** Lets the UI find out when Gmail throttles us (pass null to stop listening). */
export const onThrottle = (fn: ((ms: number) => void) | null) => {
  throttleListener = fn;
};

export type Sender = {
  address: string;
  name: string;
  category: string;
  count: number;
};
export class SessionExpiredError extends Error {}

type Msg = {
  labelIds?: string[];
  payload: { headers: { name: string; value: string }[] };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backoff = (attempt: number) =>
  Math.min(30000, 1000 * 2 ** attempt) + Math.random() * 500;

async function errorReason(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return (
      `${body.error?.errors?.[0]?.reason ?? ""} ${body.error?.message ?? ""}`.trim() ||
      "unknown reason"
    );
  } catch {
    return "unknown reason";
  }
}

export async function api<T>(
  token: string,
  path: string,
  init?: { method: "POST"; body: unknown },
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${API}${path}`, {
        method: init?.method ?? "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init ? { "Content-Type": "application/json" } : {}),
        },
        body: init ? JSON.stringify(init.body) : undefined,
      });
    } catch {
      // The request never reached Google (dropped wifi, etc.): wait and try again.
      if (attempt >= 6)
        throw new Error(
          "Lost connection to Google. Check your internet and scan again.",
        );
      await sleep(backoff(attempt));
      continue;
    }
    if (res.ok) {
      const text = await res.text(); // some Gmail calls (batchModify) return an empty body
      return (text ? JSON.parse(text) : undefined) as T;
    }
    if (res.status === 401)
      throw new SessionExpiredError(
        "Your Google session expired. Sign in again to continue.",
      );

    const reason = await errorReason(res);
    const rateLimited =
      res.status === 429 ||
      (res.status === 403 && /rate|quota|concurrent/i.test(reason));
    if (!(rateLimited || res.status >= 500) || attempt >= 7) {
      throw new Error(`Gmail returned ${res.status}: ${reason}`);
    }
    const retryAfter = Number(res.headers.get("Retry-After")) * 1000;
    const wait = retryAfter || backoff(attempt);
    if (rateLimited) throttleListener?.(wait);
    await sleep(wait);
  }
}

async function listUnreadIds(
  token: string,
  limit: number,
  signal: AbortSignal,
  onFound: (n: number) => void,
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken = "";
  do {
    if (signal.aborted) throw new DOMException("Scan cancelled", "AbortError");
    const params = new URLSearchParams({
      q: "is:unread -in:trash -in:spam",
      maxResults: "500",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await api<{
      messages?: { id: string }[];
      nextPageToken?: string;
    }>(token, `/messages?${params}`);
    ids.push(...(page.messages ?? []).map((m) => m.id));
    onFound(ids.length);
    pageToken = page.nextPageToken ?? "";
  } while (pageToken && (limit === 0 || ids.length < limit));
  return limit ? ids.slice(0, limit) : ids;
}

function parseFrom(from: string) {
  const angle = from.match(/<([^>]+)>/);
  const address = (angle ? angle[1] : from).trim().toLowerCase();
  const name = angle ? from.slice(0, angle.index).replace(/"/g, "").trim() : "";
  return { address, name };
}

/** Reads only the From header, labels, and List-Unsubscribe for each unread message (never the body). */
export async function scanInbox(
  token: string,
  limit: number, // 0 = no limit
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
  onFound: (n: number) => void = () => {},
): Promise<Sender[]> {
  const ids = await listUnreadIds(token, limit, signal, onFound);
  onProgress(0, ids.length);
  const senders = new Map<string, Sender>();
  let next = 0;
  let done = 0;
  let stopped = false;

  const worker = async () => {
    try {
      while (next < ids.length && !stopped) {
        if (signal.aborted)
          throw new DOMException("Scan cancelled", "AbortError");
        const id = ids[next++];
        const msg = await api<Msg>(
          token,
          `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=List-Unsubscribe`,
        );
        const headers = new Map(
          msg.payload.headers.map((h) => [h.name.toLowerCase(), h.value]),
        );
        const { address, name } = parseFrom(headers.get("from") ?? "");
        if (address) {
          const tab = (msg.labelIds ?? []).find((l) => l in CATEGORIES);
          const category = tab
            ? CATEGORIES[tab]
            : headers.has("list-unsubscribe")
              ? "Newsletters"
              : "Other";
          const existing = senders.get(address);
          if (existing) existing.count++;
          else senders.set(address, { address, name, category, count: 1 });
        }
        onProgress(++done, ids.length);
      }
    } catch (e) {
      stopped = true; // tell the other workers to stop sending requests
      throw e;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return [...senders.values()].sort((a, b) => b.count - a.count);
}

/** Gmail's own count of unread messages (approximate, includes every folder). */
export async function getUnreadTotal(token: string): Promise<number> {
  const label = await api<{ messagesUnread: number }>(token, "/labels/UNREAD");
  return label.messagesUnread;
}
