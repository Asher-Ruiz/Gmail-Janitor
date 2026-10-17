import { useEffect, useRef, useState } from "react";
import { getProfile, requestToken, type Profile } from "./auth";
import {
  getUnreadTotal,
  onThrottle,
  scanInbox,
  SessionExpiredError,
  SLOWDOWN_NOTE,
  type Sender,
} from "./scan";
import Progress from "./Progress";
import Review from "./Review";
import Clean, { type Stage } from "./Clean";
import { buildDatePlan, buildPlan, trashMessages, type Plan } from "./cleanup";
import Guide from "./Guide";
import DateClean from "./DateClean";
import ScopeToggle, { type Scope } from "./ScopeToggle";

const KEY = "gmail-janitor-client-id"; // a Client ID is public, so localStorage is fine
const ORIGIN = window.location.origin;

export default function App() {
  const [clientId, setClientId] = useState(
    () => localStorage.getItem(KEY) ?? "",
  );
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
  const [scanScope, setScanScope] = useState<Scope>("all");
  const [dateScope, setDateScope] = useState<Scope>("all");
  const [work, setWork] = useState({ done: 0, total: 0 });
  const [moved, setMoved] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [slowdown, setSlowdown] = useState(false);
  const [unreadTotal, setUnreadTotal] = useState<number | null>(null);
  const [mode, setMode] = useState<"senders" | "date">("senders");
  const [dateLabel, setDateLabel] = useState("");
  const [route, setRoute] = useState(() => window.location.hash);

  useEffect(() => {
    const onHash = () => {
      setRoute(window.location.hash);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

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

  const saveId = (id: string) => {
    localStorage.setItem(KEY, id);
    setClientId(id);
    window.location.hash = "/";
  };
  const resetId = () => {
    localStorage.removeItem(KEY);
    setClientId("");
    setProfile(null);
    setMode("senders");
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
    setMode("senders");
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
          scanScope === "all",
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
  const prepareDate = async (date: string) => {
    const when = new Date(`${date}T00:00:00`); // midnight in the user's own time zone
    const ctl = new AbortController();
    abort.current = ctl;
    setMode("date");
    setDateLabel(
      when.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    );
    setStage("planning");
    setError("");
    setExpired(false);
    setWork({ done: 0, total: 0 });
    setStartedAt(Date.now());
    const stopWatching = watchThrottle();
    try {
      const cutoff = Math.floor(when.getTime() / 1000);
      setPlan(
        await buildDatePlan(
          token,
          cutoff,
          dateScope === "unread",
          (n) => setWork({ done: n, total: 0 }),
          ctl.signal,
        ),
      );
      setStage("confirm");
    } catch (e) {
      fail(e);
      setStage("review");
      setMode("senders");
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
    setMode("senders");
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
        await scanInbox(
          token,
          limit,
          scanScope === "unread",
          onProgress,
          ctl.signal,
          setFound,
        ),
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

  const showGuide = !clientId || route === "#/guide";

  return (
    <main className="page">
      <header className="brand">Gmail Janitor</header>

      {showGuide && (
        <Guide
          hasClientId={Boolean(clientId)}
          origin={ORIGIN}
          onSave={saveId}
          onBack={() => {
            window.location.hash = "/";
          }}
        />
      )}

      {!showGuide && clientId && !profile && (
        <section className="card center">
          <h1>Ready when you are</h1>
          <p className="lead">
            Google will ask you to approve access, and may show a warning screen
            first. That is normal for a connection you created yourself. You can
            remove access anytime in your Google account.
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
          <a className="link-block" href="#/guide">
            Not sure what to expect? See the step-by-step guide
          </a>
          <button className="link" onClick={resetId}>
            Use a different Client ID
          </button>
        </section>
      )}

      {!showGuide && profile && !senders && mode === "senders" && (
        <section className="card center">
          <h1>You’re connected</h1>
          <p className="lead">
            Signed in as <b>{profile.emailAddress}</b>. Scanning reads each
            message’s sender and labels, never its text.
          </p>
          {!scanning && scanScope === "unread" && unreadTotal !== null && (
            <p className="lead">
              You have about <b>{unreadTotal.toLocaleString()}</b> unread
              messages. We’ll clear them in rounds: scan a batch, remove what
              you don’t want, then scan the next.
            </p>
          )}
          {!scanning && scanScope === "all" && (
            <p className="lead">
              We’ll work in rounds: scan a batch of your newest mail, remove
              what you don’t want, then scan the next.
            </p>
          )}
          {scanning ? (
            <>
              <h2 className="phase">
                {progress.total
                  ? "Step 2 of 2: reading each sender"
                  : `Step 1 of 2: finding your ${scanScope === "unread" ? "unread " : ""}messages`}
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
              <ScopeToggle value={scanScope} onChange={setScanScope} />
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
                {scanScope === "unread" ? "unread " : ""}messages
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

      {!showGuide &&
        profile &&
        !senders &&
        !scanning &&
        mode === "senders" &&
        stage === "review" && (
          <DateClean
            scope={dateScope}
            onScope={setDateScope}
            onPrepare={prepareDate}
          />
        )}

      {!showGuide && profile && mode === "date" && stage !== "review" && (
        <section className="card">
          <Clean
            mode="date"
            dateLabel={dateLabel}
            stage={stage}
            plan={plan}
            work={work}
            moved={moved}
            includeRead={dateScope === "all"}
            startedAt={startedAt}
            slowdown={slowdown}
            unreadTotal={dateScope === "unread" ? unreadTotal : null}
            onConfirm={run}
            onBack={() => {
              setStage("review");
              setMode("senders");
            }}
            onCancel={() => abort.current?.abort()}
            onFinish={finish}
          />
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

      {!showGuide && profile && senders && mode === "senders" && (
        <section className="card">
          {stage === "review" ? (
            <Review
              senders={senders}
              selected={selected}
              onChange={setSelected}
              includeRead={scanScope === "all"}
              onClean={prepare}
              onRescan={() => setSenders(null)}
            />
          ) : (
            <Clean
              mode="senders"
              dateLabel=""
              stage={stage}
              plan={plan}
              work={work}
              moved={moved}
              includeRead={scanScope === "all"}
              startedAt={startedAt}
              slowdown={slowdown}
              unreadTotal={scanScope === "unread" ? unreadTotal : null}
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
