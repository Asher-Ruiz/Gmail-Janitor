import { useEffect, useState } from "react";

function duration(seconds: number) {
  if (seconds < 45) return "under a minute";
  if (seconds < 90) return "about a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} minutes`;
  return `about ${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

type Props = {
  done: number;
  total: number;
  startedAt: number; // ms timestamp when this step began
  verb: string; // "Read", "Checked", "Moved"
  noun: string; // "messages", "senders"
  note?: string;
};

export default function Progress({
  done,
  total,
  startedAt,
  verb,
  noun,
  note,
}: Props) {
  // Tick once a second so the estimate keeps moving even between updates.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsed = (now - startedAt) / 1000;
  const rate = done >= 10 && elapsed >= 3 ? done / elapsed : 0; // average speed, pauses included
  const secondsLeft = rate ? (total - done) / rate : 0;

  return (
    <div className="progress">
      <progress value={done} max={total || 1} />
      <p>
        {verb} {done.toLocaleString()} of {total.toLocaleString()} {noun}
      </p>
      <p className="hint">
        {rate
          ? `${duration(secondsLeft)} left, at ${rate.toFixed(rate < 10 ? 1 : 0)} ${noun} per second`
          : "Estimating time left…"}
      </p>
      {note && (
        <p className="note" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
