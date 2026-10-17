import { api } from "./scan";

export type Plan = { ids: string[]; perSender: [string, number][] };

const cancelled = () => new DOMException("Cancelled", "AbortError");
// Only plain addresses go into a search, so a strange sender string can never widen the query.
const SAFE_ADDRESS = /^[^\s"'()<>{}]+@[^\s"'()<>{}]+$/;

async function listIds(
  token: string,
  q: string,
  signal: AbortSignal,
  onFound?: (n: number) => void,
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken = "";
  do {
    if (signal.aborted) throw cancelled();
    const params = new URLSearchParams({ q, maxResults: "500" });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await api<{
      messages?: { id: string }[];
      nextPageToken?: string;
    }>(token, `/messages?${params}`);
    ids.push(...(page.messages ?? []).map((m) => m.id));
    onFound?.(ids.length);
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);
  return ids;
}

/** Finds every message that would be moved. Changes nothing. Starred mail is always excluded. */
export async function buildPlan(
  token: string,
  addresses: string[],
  includeRead: boolean,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<Plan> {
  const all = new Set<string>();
  const perSender: [string, number][] = [];
  for (const [i, address] of addresses.entries()) {
    if (SAFE_ADDRESS.test(address)) {
      const ids = await listIds(
        token,
        `from:${address} -is:starred${includeRead ? "" : " is:unread"}`,
        signal,
      );
      ids.forEach((id) => all.add(id));
      if (ids.length) perSender.push([address, ids.length]);
    }
    onProgress(i + 1, addresses.length);
  }
  perSender.sort((a, b) => b[1] - a[1]);
  return { ids: [...all], perSender };
}

/** Moves messages to Trash (recoverable for 30 days). Gmail accepts up to 1,000 ids per call. */
export async function trashMessages(
  token: string,
  ids: string[],
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<void> {
  for (let i = 0; i < ids.length; i += 1000) {
    if (signal.aborted) throw cancelled();
    await api(token, "/messages/batchModify", {
      method: "POST",
      body: {
        ids: ids.slice(i, i + 1000),
        addLabelIds: ["TRASH"],
        removeLabelIds: ["INBOX"],
      },
    });
    onProgress(Math.min(i + 1000, ids.length), ids.length);
  }
}

/**
 * Finds everything received before `cutoffSeconds` (Unix time). Starred and important mail, drafts,
 * and mail the user sent are always left alone. Changes nothing.
 */
export async function buildDatePlan(
  token: string,
  cutoffSeconds: number,
  unreadOnly: boolean,
  onFound: (n: number) => void,
  signal: AbortSignal,
): Promise<Plan> {
  const q = `before:${cutoffSeconds} -is:starred -is:important -in:sent -in:drafts${unreadOnly ? " is:unread" : ""}`;
  return { ids: await listIds(token, q, signal, onFound), perSender: [] };
}
