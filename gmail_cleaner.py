"""
Gmail cleaner
=============
1) python gmail_cleaner.py scan            -> writes senders.csv (grouped by sender + category)
2) Edit senders.csv: put "yes" in the `delete` column for senders you want gone
3) python gmail_cleaner.py clean           -> moves those senders' unread mail to Trash
   python gmail_cleaner.py clean --empty-trash   -> ...then permanently empties Trash

Setup:
  pip install google-api-python-client google-auth-oauthlib
  Create an OAuth "Desktop app" client in Google Cloud Console, enable the Gmail API,
  and save the client file as credentials.json next to this script.
"""
import argparse
import csv
import os
from collections import defaultdict
from email.utils import parseaddr

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# Full-access scope is required for permanent deletion (batchDelete).
# If you only ever trash messages, "https://www.googleapis.com/auth/gmail.modify" is enough.
SCOPES = ["https://mail.google.com/"]
CSV_PATH = "senders.csv"

GMAIL_CATEGORIES = {
    "CATEGORY_PROMOTIONS": "Promotions",
    "CATEGORY_SOCIAL": "Social",
    "CATEGORY_UPDATES": "Updates",
    "CATEGORY_FORUMS": "Forums",
    "CATEGORY_PERSONAL": "Personal",
}


def get_service():
    creds = None
    if os.path.exists("token.json"):
        creds = Credentials.from_authorized_user_file("token.json", SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file("credentials.json", SCOPES)
            creds = flow.run_local_server(port=0)
        with open("token.json", "w") as f:
            f.write(creds.to_json())
    return build("gmail", "v1", credentials=creds)


def list_ids(service, query=None, label_ids=None):
    """Return every message id matching the query/labels (handles pagination)."""
    ids, token = [], None
    while True:
        resp = service.users().messages().list(
            userId="me", q=query, labelIds=label_ids,
            pageToken=token, maxResults=500,
        ).execute()
        ids += [m["id"] for m in resp.get("messages", [])]
        token = resp.get("nextPageToken")
        if not token:
            return ids


def chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def fetch_headers(service, ids):
    """Fetch From + List-Unsubscribe + labels for each id using batched requests."""
    results = {}

    def cb(request_id, response, exception):
        if exception is None:
            results[response["id"]] = response

    for group in chunks(ids, 50):
        batch = service.new_batch_http_request(callback=cb)
        for mid in group:
            batch.add(service.users().messages().get(
                userId="me", id=mid, format="metadata",
                metadataHeaders=["From", "List-Unsubscribe"],
            ))
        batch.execute()
    return results


def categorize(msg):
    headers = {h["name"].lower(): h["value"] for h in msg["payload"]["headers"]}
    for label in msg.get("labelIds", []):
        if label in GMAIL_CATEGORIES:
            return GMAIL_CATEGORIES[label], headers
    if "list-unsubscribe" in headers:
        return "Newsletter/Bulk", headers
    return "Other", headers


def scan(args):
    service = get_service()
    ids = list_ids(service, query="is:unread -in:trash -in:spam")
    print(f"Found {len(ids)} unread messages. Reading headers...")
    messages = fetch_headers(service, ids)

    senders = defaultdict(lambda: {"count": 0, "category": "Other", "name": ""})
    for msg in messages.values():
        category, headers = categorize(msg)
        name, addr = parseaddr(headers.get("from", ""))
        addr = addr.lower()
        if not addr:
            continue
        s = senders[addr]
        s["count"] += 1
        s["name"] = s["name"] or name
        s["category"] = category

    rows = sorted(senders.items(), key=lambda kv: (kv[1]["category"], -kv[1]["count"]))
    with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["delete", "category", "count", "sender", "name"])
        for addr, s in rows:
            w.writerow(["", s["category"], s["count"], addr, s["name"]])
    print(f"Wrote {len(rows)} senders to {CSV_PATH}. Put 'yes' in the delete column, then run: clean")


def clean(args):
    service = get_service()
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        targets = [r["sender"] for r in csv.DictReader(f) if r["delete"].strip().lower() in ("yes", "y", "x")]
    if not targets:
        print("No senders marked for deletion.")
        return

    query_tail = "is:unread" if not args.all_mail else ""
    to_trash = []
    for addr in targets:
        found = list_ids(service, query=f"from:{addr} {query_tail} -in:trash")
        print(f"{addr}: {len(found)} messages")
        to_trash += found
    to_trash = list(dict.fromkeys(to_trash))

    print(f"\nAbout to move {len(to_trash)} messages from {len(targets)} senders to Trash.")
    if input("Continue? (y/N) ").strip().lower() != "y":
        return
    for group in chunks(to_trash, 1000):  # API max is 1000 ids per call
        service.users().messages().batchModify(
            userId="me", body={"ids": group, "addLabelIds": ["TRASH"], "removeLabelIds": ["INBOX", "UNREAD"]},
        ).execute()
    print("Moved to Trash.")

    if args.empty_trash:
        empty_trash(service)


def empty_trash(service):
    trash_ids = list_ids(service, label_ids=["TRASH"])
    print(f"\nTrash contains {len(trash_ids)} messages (including anything you trashed earlier).")
    print("Permanent deletion CANNOT be undone.")
    if input("Type DELETE to permanently delete them: ").strip() != "DELETE":
        print("Skipped.")
        return
    for group in chunks(trash_ids, 1000):
        service.users().messages().batchDelete(userId="me", body={"ids": group}).execute()
    print("Trash emptied.")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("scan").set_defaults(fn=scan)
    c = sub.add_parser("clean")
    c.add_argument("--empty-trash", action="store_true", help="permanently delete everything in Trash afterward")
    c.add_argument("--all-mail", action="store_true", help="trash ALL mail from those senders, not just unread")
    c.set_defaults(fn=clean)
    args = p.parse_args()
    args.fn(args)