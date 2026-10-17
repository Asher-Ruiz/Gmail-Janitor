export type Scope = "all" | "unread";

export default function ScopeToggle({
  value,
  onChange,
}: {
  value: Scope;
  onChange: (s: Scope) => void;
}) {
  return (
    <div className="quick" role="group" aria-label="Which mail">
      {(["all", "unread"] as const).map((s) => (
        <button
          key={s}
          className={value === s ? "filter on" : "filter"}
          aria-pressed={value === s}
          onClick={() => onChange(s)}
        >
          {s === "all" ? "All mail" : "Only unread mail"}
        </button>
      ))}
    </div>
  );
}
