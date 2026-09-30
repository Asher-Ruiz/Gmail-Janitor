import type { Plan } from "./cleanup";
import Progress from "./progress";
import { SLOWDOWN_NOTE } from "./scan";

export type Stage = "review" | "planning" | "confirm" | "working" | "done";

type Props = {
  stage: Exclude<Stage, "review">;
  plan: Plan | null;
  work: { done: number; total: number };
  moved: number;
  startedAt: number;
  slowdown: boolean;
  unreadTotal: number | null;
  includeRead: boolean;
  onConfirm: () => void;
  onBack: () => void;
  onCancel: () => void;
  onFinish: () => void;
};

export default function Clean({
  stage,
  plan,
  work,
  moved,
  startedAt,
  slowdown,
  unreadTotal,
  includeRead,
  onConfirm,
  onBack,
  onCancel,
  onFinish,
}: Props) {
  if (stage === "planning") {
    return (
      <div className="center">
        <h1>Counting what would move</h1>
        <Progress
          done={work.done}
          total={work.total}
          startedAt={startedAt}
          verb="Checked"
          noun="senders"
          note={slowdown ? SLOWDOWN_NOTE : undefined}
        />
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  }

  if (stage === "confirm" && plan) {
    const total = plan.ids.length;
    if (total === 0) {
      return (
        <div className="center">
          <h1>Nothing to move</h1>
          <p className="lead">
            None of the selected senders have {includeRead ? "" : "unread "}mail
            that isn’t starred.
          </p>
          <button className="btn" onClick={onBack}>
            Go back
          </button>
        </div>
      );
    }
    return (
      <div className="center">
        <h1>Move {total.toLocaleString()} messages to Trash?</h1>
        <p className="lead">
          This covers {includeRead ? "read and unread" : "unread"} mail from{" "}
          {plan.perSender.length.toLocaleString()} senders, across your whole
          mailbox. Starred messages are left alone. You can restore anything
          from Trash for 30 days.
        </p>
        <ul className="top">
          {plan.perSender.slice(0, 5).map(([address, n]) => (
            <li key={address}>
              <span>{address}</span>
              <b>{n.toLocaleString()}</b>
            </li>
          ))}
          {plan.perSender.length > 5 && (
            <li className="more">
              and {plan.perSender.length - 5} more senders
            </li>
          )}
        </ul>
        <div className="actions">
          <button className="btn ghost" onClick={onBack}>
            Go back
          </button>
          <button className="btn danger" onClick={onConfirm}>
            Move {total.toLocaleString()} to Trash
          </button>
        </div>
      </div>
    );
  }

  if (stage === "working") {
    return (
      <div className="center">
        <h1>Moving mail to Trash</h1>
        <Progress
          done={work.done}
          total={work.total}
          startedAt={startedAt}
          verb="Moved"
          noun="messages"
          note={slowdown ? SLOWDOWN_NOTE : undefined}
        />
        <button className="btn ghost" onClick={onCancel}>
          Stop
        </button>
      </div>
    );
  }

  return (
    <div className="center">
      <h1>Moved {moved.toLocaleString()} messages to Trash</h1>
      <p className="lead">
        Open Trash in Gmail to review or restore them. Gmail empties Trash on
        its own after 30 days.
      </p>
      {unreadTotal !== null && (
        <p className="lead">
          About {unreadTotal.toLocaleString()} unread messages are left in your
          mailbox.
        </p>
      )}
      <button className="btn" onClick={onFinish}>
        Scan the next batch
      </button>
    </div>
  );
}
