import { useRef, useState, type ReactNode } from "react";
import { getProfile, requestToken, type Profile } from "./auth";
import {
  getUnreadTotal,
  onThrottle,
  scanInbox,
  SessionExpiredError,
  SLOWDOWN_NOTE,
  type Sender,
} from "./scan";
import Progress from "./progress";
import Review from "./review";
import Clean, { type Stage } from "./clean";
import { buildPlan, trashMessages, type Plan } from "./cleanup";

const KEY = "gmail-janitor-client-id"; // a Client ID is public, so localStorage is fine
const ORIGIN = window.location.origin;
const ID_PATTERN = /^[\w-]+\.apps\.googleusercontent\.com$/;

const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer">
    {children}
  </a>
);

function CopyChip({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };
  return (
    <button className="chip" onClick={copy}>
      <code>{text}</code>
      <span>{done ? "Copied" : "Copy"}</span>
    </button>
  );
}

const STEPS: { title: string; body: ReactNode }[] = [
  {
    title: "Create a project",
    body: (
      <>
        Open the{" "}
        <A href="https://console.cloud.google.com/projectcreate">
          Google Cloud Console
        </A>{" "}
        and create a project. Name it anything, like “Gmail Janitor”.
      </>
    ),
  },
  {
    title: "Turn on the Gmail API",
    body: (
      <>
        Open{" "}
        <A href="https://console.cloud.google.com/apis/library/gmail.googleapis.com">
          the Gmail API page
        </A>
        , check that your new project is selected, and click <b>Enable</b>.
      </>
    ),
  },
  {
    title: "Set up the consent screen",
    body: (
      <>
        Open{" "}
        <A href="https://console.cloud.google.com/auth/overview">
          Google Auth Platform
        </A>{" "}
        and click <b>Get started</b>. Choose <b>External</b> as the audience.
        Then open <b>Audience</b> and add your own Gmail address as a{" "}
        <b>test user</b>.
      </>
    ),
  },
  {
    title: "Create your Client ID",
    body: (
      <>
        Open <b>Clients</b>, click <b>Create client</b>, and choose{" "}
        <b>Web application</b>. Under <b>Authorized JavaScript origins</b>, add:{" "}
        <CopyChip text={ORIGIN} />
      </>
    ),
  },
];

export default function App() {
  const [clientId, setClientId] = useState(
    () => localStorage.getItem(KEY) ?? "",
  );
  const [draft, setDraft] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const [expired, setExpired] = useState(false);
  const [limit, setLimit] = useState(5000);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [found, setFound] = useState(0);
  const [senders, setSenders] = useState<Sender[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const abort = useRef<AbortController | null>(null);
  const [stage, setStage] = useState<Stage>("review");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [includeRead, setIncludeRead] = useState(false);
  const [work, setWork] = useState({ done: 0, total: 0 });
  const [moved, setMoved] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [slowdown, setSlowdown] = useState(false);
  const [unreadTotal, setUnreadTotal] = useState<number | null>(null);

  const loadUnread = (t: string) =>
    getUnreadTotal(t).then(setUnreadTotal, () => setUnreadTotal(null));
  /** Shows a "we're pausing" note while Gmail throttles us. Returns a cleanup function. */
  const watchThrottle = () => {
    let timer: number | undefined;
    onThrottle((ms) => {
      setSlowdown(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setSlowdown(false), ms);
    });
    return () => {
      onThrottle(null);
      window.clearTimeout(timer);
      setSlowdown(false);
    };
  };

  const saveId = () => {
    const id = draft.trim();
    localStorage.setItem(KEY, id);
    setClientId(id);
  };
  const resetId = () => {
    localStorage.removeItem(KEY);
    setClientId("");
    setDraft("");
    setProfile(null);
    setError("");
    setToken("");
    setUnreadTotal(null);
    setSenders(null);
    setSelected(new Set());
    setStage("review");
  };
  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      const t = await requestToken(clientId);
      setToken(t);
      loadUnread(t);
      setProfile(await getProfile(t));
      setExpired(false);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };
  const fail = (e: unknown) => {
    if (e instanceof DOMException && e.name === "AbortError") return;
    setError(e instanceof Error ? e.message : "Something went wrong.");
    setExpired(e instanceof SessionExpiredError);
  };
  const prepare = async () => {
    const ctl = new AbortController();
    abort.current = ctl;
    setStage("planning");
    setError("");
    setExpired(false);
    setWork({ done: 0, total: selected.size });
    setStartedAt(Date.now());
    const stopWatching = watchThrottle();
    try {
      setPlan(
        await buildPlan(
          token,
          [...selected],
          includeRead,
          (done, total) => setWork({ done, total }),
          ctl.signal,
        ),
      );
      setStage("confirm");
    } catch (e) {
      fail(e);
      setStage("review");
    } finally {
      stopWatching();
    }
  };
  const run = async () => {
    if (!plan) return;
    const ctl = new AbortController();
    abort.current = ctl;
    let count = 0;
    setStage("working");
    setError("");
    setWork({ done: 0, total: plan.ids.length });
    setStartedAt(Date.now());
    const stopWatching = watchThrottle();
    try {
      await trashMessages(
        token,
        plan.ids,
        (done, total) => {
          count = done;
          setWork({ done, total });
        },
        ctl.signal,
      );
      setMoved(plan.ids.length);
      setStage("done");
      loadUnread(token);
    } catch (e) {
      fail(e);
      if (e instanceof DOMException && e.name === "AbortError") {
        setMoved(count); // stopped early: report what actually moved
        setStage("done");
        loadUnread(token);
      } else {
        setStage("confirm");
      }
    } finally {
      stopWatching();
    }
  };
  const finish = () => {
    setSenders(null);
    setSelected(new Set());
    setPlan(null);
    setStage("review");
  };
  const scan = async () => {
    const ctl = new AbortController();
    abort.current = ctl;
    setScanning(true);
    setError("");
    setExpired(false);
    setProgress({ done: 0, total: 0 });
    setFound(0);
    const stopWatching = watchThrottle();
    try {
      const onProgress = (done: number, total: number) => {
        if (done === 0) setStartedAt(Date.now()); // reading starts once the list is complete
        setProgress({ done, total });
      };
      setSenders(
        await scanInbox(token, limit, onProgress, ctl.signal, setFound),
      );
      setSelected(new Set());
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e instanceof Error ? e.message : "The scan failed.");
        setExpired(e instanceof SessionExpiredError);
      }
    } finally {
      stopWatching();
      setScanning(false);
    }
  };

  const idLooksValid = ID_PATTERN.test(draft.trim());

  return (
    <main className="page">
      <header className="brand">Gmail Janitor</header>

      {!clientId && (
        <section className="card">
          <h1>Let’s connect your Gmail</h1>
          <p className="lead">
            Your mail stays between your browser and Google. Nothing is uploaded
            anywhere else. Setup takes about five minutes and you only do it
            once.
          </p>
          <ol className="steps">
            {STEPS.map((s) => (
              <li key={s.title}>
                <h2>{s.title}</h2>
                <p>{s.body}</p>
              </li>
            ))}
            <li>
              <h2>Paste your Client ID</h2>
              <p>
                Copy the Client ID from the confirmation window and paste it
                here.
              </p>
              <div className="row">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="1234567890-abc123.apps.googleusercontent.com"
                  aria-label="Client ID"
                />
                <button
                  className="btn"
                  disabled={!idLooksValid}
                  onClick={saveId}
                >
                  Save Client ID
                </button>
              </div>
              {draft && !idLooksValid && (
                <p className="hint">
                  A Client ID ends in .apps.googleusercontent.com
                </p>
              )}
            </li>
          </ol>
        </section>
      )}

      {clientId && !profile && (
        <section className="card center">
          <h1>Ready when you are</h1>
          <p className="lead">
            Sign in with Google and approve access. You can revoke it anytime in
            your Google account.
          </p>
          <button className="btn" onClick={connect} disabled={busy}>
            {busy ? "Waiting for Google…" : "Sign in with Google"}
          </button>
          {error && (
            <p className="error" role="alert">
              {error} Check that your email is a test user and that the
              authorized origin is {ORIGIN}.
            </p>
          )}
          <button className="link" onClick={resetId}>
            Use a different Client ID
          </button>
        </section>
      )}

      {profile && !senders && (
        <section className="card center">
          <h1>You’re connected</h1>
          <p className="lead">
            Signed in as <b>{profile.emailAddress}</b>. Scanning reads each
            unread message’s sender and labels, never its text.
          </p>
          {unreadTotal !== null && !scanning && (
            <p className="lead">
              You have about <b>{unreadTotal.toLocaleString()}</b> unread
              messages. We’ll clear them in rounds: scan a batch, remove what
              you don’t want, then scan the next.
            </p>
          )}
          {scanning ? (
            <>
              <h2 className="phase">
                {progress.total
                  ? "Step 2 of 2: reading each sender"
                  : "Step 1 of 2: finding your unread messages"}
              </h2>
              {progress.total ? (
                <Progress
                  done={progress.done}
                  total={progress.total}
                  startedAt={startedAt}
                  verb="Read"
                  noun="messages"
                  note={slowdown ? SLOWDOWN_NOTE : undefined}
                />
              ) : (
                <p className="hint">
                  {found
                    ? `Found ${found.toLocaleString()} so far…`
                    : "Starting…"}
                </p>
              )}
              <button className="btn" onClick={() => abort.current?.abort()}>
                Cancel scan
              </button>
            </>
          ) : (
            <>
              <label className="pick">
                Scan the newest{" "}
                <select
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                >
                  <option value={1000}>1,000</option>
                  <option value={5000}>5,000</option>
                  <option value={10000}>10,000</option>
                </select>{" "}
                unread messages
              </label>
              <button
                className="btn"
                onClick={expired ? connect : scan}
                disabled={busy}
              >
                {expired ? "Sign in again" : "Scan my inbox"}
              </button>
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="link" onClick={resetId}>
            Disconnect
          </button>
        </section>
      )}

      {profile && senders && (
        <section className="card">
          {stage === "review" ? (
            <Review
              senders={senders}
              selected={selected}
              onChange={setSelected}
              includeRead={includeRead}
              onIncludeRead={setIncludeRead}
              onClean={prepare}
              onRescan={() => setSenders(null)}
            />
          ) : (
            <Clean
              stage={stage}
              plan={plan}
              work={work}
              moved={moved}
              includeRead={includeRead}
              startedAt={startedAt}
              slowdown={slowdown}
              unreadTotal={unreadTotal}
              onConfirm={run}
              onBack={() => setStage("review")}
              onCancel={() => abort.current?.abort()}
              onFinish={finish}
            />
          )}
          {error && (
            <p className="error" role="alert">
              {error}{" "}
              {expired && (
                <button className="link inline" onClick={connect}>
                  Sign in again
                </button>
              )}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
