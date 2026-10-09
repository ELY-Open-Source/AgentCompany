import { SignInStatus } from "../pages/connectors/SignInStatus";
import { useMemo } from "react";
import type { AppSnapshot } from "../../../shared/domain";
import { Button } from "../shared/ui";
import { ToolkitCatalog } from "../pages/connectors/ToolkitCatalog";
import { useConnectorCatalog } from "../pages/connectors/useConnectorCatalog";
import { DEFAULT_CONNECTOR_ACCOUNT_LABEL } from "../../../shared/commands";
import type { SnapshotActions } from "./useSnapshot";
import { t } from "../i18n/i18n";

/**
 * The post-launch onboarding step: the company exists, so connections can be
 * made against it. Connecting is optional — Finish enters the app either way
 * and the Connectors page carries the same catalog.
 */
export function ConnectorsStep({
  orgId,
  snapshot,
  actions,
  onFinish,
}: {
  orgId: string;
  snapshot: AppSnapshot;
  actions: SnapshotActions;
  onFinish: () => void;
}) {
  const { catalog, busySlug, connectError, signIn, stopWaiting, checkAgain, connect, retry } = useConnectorCatalog(orgId, actions);
  const connectedSlugs = useMemo(
    () =>
      new Set(
        snapshot.connectorAccounts
          .filter((account) => account.orgId === orgId && account.status === "ACTIVE")
          .map((account) => account.toolkitSlug),
      ),
    [snapshot.connectorAccounts, orgId],
  );

  return (
    <div className="form-grid">
      <h2 className="page-h1">{t("Connectors")}</h2>
      {catalog.phase === "error" && (
        <div className="row" style={{ gap: 10 }}>
          <span
            style={{
              color: "var(--text-2)",
              fontSize: 13,
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {catalog.message}
          </span>
          <Button size="small" onClick={retry}>{t("Retry")}</Button>
        </div>
      )}
      {catalog.phase === "ready" && (
        <div style={{ maxHeight: 420, overflowY: "auto", paddingRight: 4 }}>
          <ToolkitCatalog
            entries={catalog.entries}
            connectedSlugs={connectedSlugs}
            busySlug={busySlug}
            onConnect={(slug) => connect(slug, DEFAULT_CONNECTOR_ACCOUNT_LABEL)}
          />
        </div>
      )}
      {signIn && <SignInStatus signIn={signIn} onStop={stopWaiting} onCheckAgain={checkAgain} />}
      {connectError && (
        <div
          style={{
            color: "var(--red)",
            fontSize: 13,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {connectError}
        </div>
      )}
      <div className="modal-actions" style={{ marginTop: 4 }}>
        <Button tone="primary" onClick={onFinish}>{t("Finish")}</Button>
      </div>
    </div>
  );
}
