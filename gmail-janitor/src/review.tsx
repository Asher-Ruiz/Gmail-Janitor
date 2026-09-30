import { useMemo, useState } from "react";
import type { Sender } from "./scan";

type Props = {
  senders: Sender[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  includeRead: boolean;
  onIncludeRead: (v: boolean) => void;
  onClean: () => void;
  onRescan: () => void;
};

export default function Review({
  senders,
  selected,
  onChange,
  includeRead,
  onIncludeRead,
  onClean,
  onRescan,
}: Props) {
  const [filter, setFilter] = useState("All");

  const categories = useMemo(() => {
    const totals = new Map<string, number>();
    for (const s of senders)
      totals.set(s.category, (totals.get(s.category) ?? 0) + s.count);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [senders]);

  const visible =
    filter === "All" ? senders : senders.filter((s) => s.category === filter);
  const allChecked =
    visible.length > 0 && visible.every((s) => selected.has(s.address));
  const picked = senders.filter((s) => selected.has(s.address));
  const pickedMessages = picked.reduce((sum, s) => sum + s.count, 0);

  const toggle = (address: string) => {
    const next = new Set(selected);
    if (next.has(address)) next.delete(address);
    else next.add(address);
    onChange(next);
  };
  const toggleVisible = () => {
    const next = new Set(selected);
    for (const s of visible) {
      if (allChecked) next.delete(s.address);
      else next.add(s.address);
    }
    onChange(next);
  };

  return (
    <>
      <h1>Choose what to remove</h1>
      <p className="lead">
        Check the senders you want gone. Nothing changes in Gmail until you
        clean, and even then mail goes to Trash first.
      </p>

      <div className="filters" role="tablist" aria-label="Category">
        {[
          ["All", senders.reduce((t, s) => t + s.count, 0)] as const,
          ...categories,
        ].map(([name, total]) => (
          <button
            key={name}
            role="tab"
            aria-selected={filter === name}
            className={filter === name ? "filter on" : "filter"}
            onClick={() => setFilter(name)}
          >
            {name} ({total.toLocaleString()})
          </button>
        ))}
      </div>

      <label className="sender all">
        <input type="checkbox" checked={allChecked} onChange={toggleVisible} />
        <span>Select all {visible.length.toLocaleString()} senders shown</span>
      </label>

      <ul className="senders">
        {visible.map((s) => (
          <li key={s.address}>
            <label className="sender">
              <input
                type="checkbox"
                checked={selected.has(s.address)}
                onChange={() => toggle(s.address)}
              />
              <span className="who">
                <b>{s.name || s.address}</b>
                {s.name && <small>{s.address}</small>}
              </span>
              <span className="n">{s.count.toLocaleString()}</span>
            </label>
          </li>
        ))}
      </ul>

      <label className="opt">
        <input
          type="checkbox"
          checked={includeRead}
          onChange={(e) => onIncludeRead(e.target.checked)}
        />
        <span>
          Also include mail I’ve already read. Starred mail is never moved.
        </span>
      </label>

      <div className="bar">
        <span>
          {picked.length.toLocaleString()} senders selected,{" "}
          {pickedMessages.toLocaleString()} messages
        </span>
        <button
          className="btn danger"
          disabled={picked.length === 0}
          onClick={onClean}
        >
          Move to Trash
        </button>
      </div>
      <button className="link" onClick={onRescan}>
        Scan again
      </button>
    </>
  );
}
