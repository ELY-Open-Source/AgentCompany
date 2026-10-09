import type { TaskHold } from "../../../../shared/domain";
import { t } from "../../i18n/i18n";

function when(iso: string): string {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Why an open task is not moving, when it resumes on its own, and whether it waits on the operator. */
export function TaskHoldNotice({ hold }: { hold: TaskHold }) {
  const next = hold.waitingOn === "provider"
    ? t("Resumes on its own at {time}.", { time: when(hold.resumesAt) })
    : hold.resumesAt
      ? t("Waiting on you, or resumes on its own at {time}.", { time: when(hold.resumesAt) })
      : t("Waiting on you.");
  const color = hold.waitingOn === "operator" ? "var(--red)" : "var(--amber)";
  return (
    <div role="status" style={{ marginBottom: 12, fontSize: "var(--fs-body)", color, lineHeight: 1.5 }}>
      <div>{hold.reason}</div>
      <div>{next}</div>
    </div>
  );
}
