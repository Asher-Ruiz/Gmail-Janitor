import { useState } from "react";
import ScopeToggle, { type Scope } from "./ScopeToggle";

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const yearsAgo = (n: number) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return iso(d);
};
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
};

type Props = {
  scope: Scope;
  onScope: (s: Scope) => void;
  onPrepare: (date: string) => void;
};

export default function DateClean({ scope, onScope, onPrepare }: Props) {
  const [date, setDate] = useState("");
  const isRecent = date !== "" && date > daysAgo(90);

  return (
    <section className="card center">
      <h2 className="phase">Or clear out old mail by date</h2>
      <p className="lead">
        Move every {scope === "unread" ? "unread " : ""}email you received
        before a date to Trash. Starred and important emails, drafts, and emails
        you sent are never touched.
      </p>
      <ScopeToggle value={scope} onChange={onScope} />
      <div className="quick">
        {[1, 2, 5].map((n) => (
          <button
            key={n}
            className="filter"
            onClick={() => setDate(yearsAgo(n))}
          >
            {n} {n === 1 ? "year" : "years"} ago
          </button>
        ))}
      </div>
      <label className="pick">
        Everything before{" "}
        <input
          type="date"
          value={date}
          max={iso(new Date())}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      {isRecent && (
        <p className="hint">
          That date is fairly recent, so this would include mail from the last
          few months.
        </p>
      )}
      <button className="btn" disabled={!date} onClick={() => onPrepare(date)}>
        Count these emails
      </button>
      <p className="hint">
        Nothing moves yet. You’ll see the exact number first.
      </p>
    </section>
  );
}
