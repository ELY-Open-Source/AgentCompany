import { useEffect, useState } from "react";
import type { ProviderDisconnectImpact } from "../../../../shared/commands";
import type { ProviderRecord } from "../../../../shared/domain";
import type { SnapshotActions } from "../../app/useSnapshot";
import { Dialog } from "../../shared/Dialog";
import { t } from "../../i18n/i18n";

/** Shows what a disconnect stops before it happens, then its outcome, including a provider that refused to revoke. */
export function DisconnectProviderDialog({ orgId, provider, revokesRemotely, actions, onClose }: {
  orgId: string;
  provider: ProviderRecord;
  revokesRemotely: boolean;
  actions: SnapshotActions;
  onClose: () => void;
}) {
  const [impact, setImpact] = useState<ProviderDisconnectImpact | null>(null);
  const [state, setState] = useState<{ kind: "idle" | "busy" | "done" } | { kind: "error"; message: string }>({ kind: "idle" });

  useEffect(() => {
    let live = true;
    void window.agentCompany.providerDisconnectImpact({ orgId, providerId: provider.id }).then((result) => {
      if (!live) return;
      if (result.ok) setImpact(result.data);
      else setState({ kind: "error", message: result.error.message });
    });
    return () => { live = false; };
  }, [orgId, provider.id]);

  const disconnect = () => {
    setState({ kind: "busy" });
    actions.run(() => window.agentCompany.revokeProviderCredential({ orgId, providerId: provider.id }))
      .then(() => setState({ kind: "done" }))
      .catch((failure: unknown) => setState({ kind: "error", message: failure instanceof Error ? failure.message : String(failure) }));
  };

  const finished = state.kind === "done";
  return (
    <Dialog
      title={t("Disconnect {label}?", { label: provider.label })}
      open
      submitLabel={state.kind === "busy" ? t("Disconnecting…") : t("Disconnect")}
      hideSubmit={finished || impact === null}
      onClose={onClose}
      onSubmit={(event) => { event.preventDefault(); if (state.kind !== "busy") disconnect(); }}
    >
      {finished ? (
        <p role="status" style={{ margin: 0 }}>{t("{label} is disconnected.", { label: provider.label })}</p>
      ) : impact === null ? (
        state.kind !== "error" && <p style={{ margin: 0, color: "var(--text-3)" }}>{t("Checking what this affects…")}</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6, fontSize: "var(--fs-body)" }}>
          <li>{impact.agents.length
            ? t("Agents on this provider stop working until it is reconnected or they move to another provider: {names}.", { names: impact.agents.join(", ") })
            : t("No agent uses this provider.")}</li>
          {impact.agents.length > 0 && <li>{t("Open tasks assigned to them: {count}.", { count: impact.openTasks })}</li>}
          <li>{t("Running sessions that stop now: {count}.", { count: impact.runningRuns })}</li>
          <li>{t("Queued sessions that will fail when they start: {count}.", { count: impact.queuedRuns })}</li>
          <li>{revokesRemotely
            ? t("Revokes the sign-in at {provider} and erases it from this computer.", { provider: provider.label })
            : t("Erases the key from this computer. {provider} keeps accepting it until you revoke it in your account.", { provider: provider.label })}</li>
        </ul>
      )}
      {state.kind === "error" && <div className="form-error" role="alert">{state.message}</div>}
    </Dialog>
  );
}
