import { useState, type ReactNode } from 'react'

const ID_PATTERN = /^[\w-]+\.apps\.googleusercontent\.com$/

const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer">{children}</a>
)
const K = ({ children }: { children: ReactNode }) => <b className="key">{children}</b>

function CopyChip({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text)
    setDone(true)
    setTimeout(() => setDone(false), 1500)
  }
  return (
    <button className="chip" onClick={copy}>
      <code>{text}</code>
      <span>{done ? 'Copied' : 'Copy'}</span>
    </button>
  )
}

/** Screenshots live in public/guide/. If a file is missing, a friendly placeholder shows instead. */
function Shot({ file, caption }: { file: string; caption: string }) {
  const [missing, setMissing] = useState(false)
  return (
    <figure className="shot">
      {missing ? (
        <div className="shot-empty">Picture coming soon</div>
      ) : (
        <img src={`${import.meta.env.BASE_URL}guide/${file}`} alt={caption} loading="lazy" onError={() => setMissing(true)} />
      )}
      <figcaption>{caption}</figcaption>
    </figure>
  )
}

type Props = { hasClientId: boolean; origin: string; onSave: (id: string) => void; onBack: () => void }

export default function Guide({ hasClientId, origin, onSave, onBack }: Props) {
  const [draft, setDraft] = useState('')
  const valid = ID_PATTERN.test(draft.trim())

  const steps: { title: string; body: ReactNode; see: string; file: string; caption: string }[] = [
    {
      title: 'Create your own project in Google',
      body: <>Open <A href="https://console.cloud.google.com/projectcreate">Google Cloud’s “New project” page</A> (it opens in a new tab). Sign in with the Google account whose email you want to tidy. In the project name box, type <K>Gmail Janitor</K>, then click <K>Create</K>. If Google asks you to agree to its terms, tick the box and continue.</>,
      see: 'A page with a box for the project name and a blue Create button.',
      file: 'step-1.png',
      caption: 'The “New Project” page',
    },
    {
      title: 'Turn on the Gmail connection',
      body: <>Open <A href="https://console.cloud.google.com/apis/library/gmail.googleapis.com">the Gmail API page</A>. Check that “Gmail Janitor” is shown at the top of the page, then click the blue <K>Enable</K> button.</>,
      see: 'A page titled “Gmail API.” After you click Enable, it changes to show the API is on.',
      file: 'step-2.png',
      caption: 'The Gmail API page with the Enable button',
    },
    {
      title: 'Set up the permission screen',
      body: <>Open <A href="https://console.cloud.google.com/auth/overview">Google Auth Platform</A> and click <K>Get started</K>. For the app name, type <K>Gmail Janitor</K>, and choose your email from the list. Click <K>Next</K>. Choose <K>External</K>, then <K>Next</K>. Type your email again as the contact, then <K>Next</K>. Tick the agreement box, then click <K>Continue</K> and <K>Create</K>.</>,
      see: 'A short form with several Next buttons. This is only the label Google shows when you approve access later. No one else sees it.',
      file: 'step-3.png',
      caption: 'The “Get started” form',
    },
    {
      title: 'Add yourself as a test user',
      body: <>In the menu on the left, click <K>Audience</K>. Scroll down to <K>Test users</K> and click <K>Add users</K>. Type your own Gmail address and click <K>Save</K>.</>,
      see: 'Your email address appears in a list under Test users. This is what lets you, and only you, use your connection.',
      file: 'step-4.png',
      caption: 'Your email listed under Test users',
    },
    {
      title: 'Create your Client ID',
      body: <>In the menu on the left, click <K>Clients</K>, then <K>Create client</K>. Under Application type, choose <K>Web application</K>. Scroll to <K>Authorized JavaScript origins</K>, click <K>Add URI</K>, and paste this address: <CopyChip text={origin} /> Then click <K>Create</K>.</>,
      see: 'A box titled “OAuth client created” with a long Client ID ending in .apps.googleusercontent.com. Copy it using the copy icon next to it. You may also see a “client secret.” You do not need it and should never share it.',
      file: 'step-5.png',
      caption: 'The “OAuth client created” box',
    },
  ]

  return (
    <section className="card guide">
      {hasClientId && (
        <button className="link guide-top" onClick={onBack}>Back to the app</button>
      )}
      <h1>Let’s connect your Gmail</h1>
      <p className="lead">
        This takes about 10 minutes. You can stop and come back at any time. Google changes its screens now and
        then, so if something looks a little different, look for the same button names.
      </p>

      <div className="callout">
        <h2>Is this safe? Here is the honest answer.</h2>
        <ul>
          <li>Nothing you do here is sent to me. This website runs inside your own browser and talks directly to Google.</li>
          <li>In the steps below, you create your own private connection to your own Gmail. Nobody else, including me, is given a key to it.</li>
          <li>The tool does two things: it looks at who your emails are from, and it moves the emails you choose to Trash. Trash keeps them for 30 days, so you can undo.</li>
          <li>Close this page and the tool can no longer reach your mail. You can also remove access any time on Google’s <A href="https://myaccount.google.com/connections">third-party apps page</A>.</li>
          <li>Why so many steps? A shared app would need an expensive Google security review. Setting it up yourself keeps your mail away from my computers entirely, because there is no server in the middle.</li>
        </ul>
      </div>

      <ol className="steps">
        {steps.map((s) => (
          <li key={s.title}>
            <h2>{s.title}</h2>
            <p>{s.body}</p>
            <p className="see">What you should see: {s.see}</p>
            <Shot file={s.file} caption={s.caption} />
          </li>
        ))}
        <li>
          <h2>Paste your Client ID here</h2>
          <label className="field" htmlFor="client-id">Paste the Client ID you copied in the last step.</label>
          <div className="row">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="1234567890-abc123.apps.googleusercontent.com"
              id="client-id"
              autoComplete="off"
              aria-invalid={draft !== '' && !valid}
              aria-describedby={draft !== '' && !valid ? 'client-id-hint' : undefined}
            />
            <button className="btn" disabled={!valid} onClick={() => onSave(draft.trim())}>Save and continue</button>
          </div>
          {draft && !valid && (
            <p id="client-id-hint" className="error">A Client ID ends in .apps.googleusercontent.com</p>
          )}
        </li>
      </ol>

      <div className="callout">
        <h2>What happens next, so nothing surprises you</h2>
        <p>
          After you click Sign in with Google, Google shows a warning that it hasn’t verified the app. That is normal,
          because you made the app yourself a few minutes ago. Click <K>Advanced</K>, then click the link at the
          bottom that starts with <K>Go to Gmail Janitor</K>.
        </p>
        <Shot file="signin-1.png" caption="Google’s “hasn’t verified this app” screen" />
        <p>
          Next, Google lists what you are allowing. Its wording can sound strong, such as reading and composing email.
          That is Google’s standard wording for this level of access. Gmail Janitor only looks at who your emails are
          from and moves emails you choose to Trash. If you see a small tick box next to the permission, tick it, then
          click <K>Continue</K>.
        </p>
        <Shot file="signin-2.png" caption="Google’s permission screen" />
      </div>
    </section>
  )
}
