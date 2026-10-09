import { useEffect, useState } from "react";
import type { RunRequestRecord } from "../../../../shared/provider-runtime-domain";
import { Pill } from "../../shared/ui";
import { t } from "../../i18n/i18n";

function purposeLabel(purpose: string): string {
  if (purpose === "agent_turn") return t("Turn");
  if (purpose === "goal_audit") return t("Goal audit");
  if (purpose === "model_check") return t("Model check");
  if (purpose === "manual") return t("Manual");
  return t("Earlier call");
}

/** Every model call the run made, in order, so a turn or an audit can be found by its task. */
export function RunRequestList({ orgId, runId, state }: { orgId: string; runId: string; state: string }) {
  // Fetched calls are kept with the run they belong to, so switching runs never shows another run's chain.
  const [loaded, setLoaded] = useState<{ runId: string; requests: RunRequestRecord[] } | { runId: string; error: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    window.agentCompany.runRequests({ orgId, runId })
      .then((result) => {
        if (cancelled) return;
        setLoaded(result.ok ? { runId, requests: result.data } : { runId, error: result.error.message });
      })
      .catch((reason: unknown) => {
        if (!cancelled) setLoaded({ runId, error: reason instanceof Error ? reason.message : String(reason) });
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, runId, state]);

  if (!loaded || loaded.runId !== runId) return null;
  if ("error" in loaded) return <div className="form-error" role="alert">{loaded.error}</div>;
  const { requests } = loaded;
  return (
    <div style={{ marginBottom: 20 }}>
      <div className="section-label" style={{ marginBottom: 8 }}>{t("Model calls ({count})", { count: String(requests.length) })}</div>
      {requests.length === 0 && <div style={{ fontSize: 13, color: "var(--text-3)" }}>{t("This run made no model call.")}</div>}
      {requests.map((request, index) => (
        <div key={request.id} className="row" style={{ gap: 10, fontSize: 13, padding: "6px 0", borderBottom: "1px solid var(--border-soft)" }}>
          <span className="mono" style={{ color: "var(--text-3)", width: 24 }}>{index + 1}</span>
          <span style={{ width: 96 }}>{purposeLabel(request.purpose)}</span>
          <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{request.model}</span>
          <Pill tone={request.state === "failed" ? "red" : request.state === "succeeded" ? "green" : "amber"}>{request.state}</Pill>
          <span className="mono" style={{ color: "var(--text-3)", width: 120, textAlign: "right" }}>
            {request.inputTokens ?? "—"} / {request.outputTokens ?? "—"}
          </span>
          {request.errorMessage && <span style={{ color: "var(--red)", flexBasis: "100%", whiteSpace: "pre-wrap" }}>{request.errorMessage}</span>}
        </div>
      ))}
    </div>
  );
}
